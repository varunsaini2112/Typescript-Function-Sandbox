import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import Sidebar, { type MethodBadge } from './components/Sidebar';
import RunPanel from './components/RunPanel';
import TestsPanel from './components/TestsPanel';
import TagEditor from './components/TagEditor';
import Toast, { type ToastState } from './components/Toast';
import ExportMenu from './components/ExportMenu';
import { detectEntryName, hashCode } from './lib/compile';
import { generateSourceFile, generateTestFile, parseSourceFile } from './lib/codegen';
import { getDiagnostics } from './lib/diagnostics';
import { isPass, runMethod, runTests } from './lib/runner';
import { applyTheme, watchSystemTheme } from './lib/theme';
import {
  DEFAULT_PREAMBLE,
  exportJson,
  importJson,
  loadWorkspace,
  missingExamples,
  newMethod,
  newTest,
  pushHistory,
  saveWorkspace,
  seedWorkspace,
  uid,
  uniqueName,
} from './lib/storage';
import type {
  MethodDoc,
  SandboxResult,
  SourceLocation,
  TestCase,
  ThemePref,
  TypeDiagnostic,
  Workspace,
} from './types';

type ResultsByMethod = Record<string, Record<string, SandboxResult>>;

const THEME_LABEL: Record<ThemePref, string> = { light: '☀ Light', dark: '☾ Dark', system: '◐ System' };
const THEME_ORDER: ThemePref[] = ['system', 'light', 'dark'];

const PREAMBLE_URI = 'file:///preamble.ts';

function download(name: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoking in the same tick can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace());
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tab, setTab] = useState<'run' | 'tests'>('run');
  const [editingPreamble, setEditingPreamble] = useState(false);
  const [runResults, setRunResults] = useState<Record<string, SandboxResult>>({});
  const [testResults, setTestResults] = useState<ResultsByMethod>({});
  const [runningRun, setRunningRun] = useState(false);
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());
  const [diagnostics, setDiagnostics] = useState<Record<string, TypeDiagnostic[]>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, options: Partial<ToastState> = {}) => {
    setToast({ id: uid(), message, ...options });
  }, []);

  // ---- persistence ----------------------------------------------------------

  // Debounced: the editor fires on every keystroke, and serialising the whole
  // workspace that often is pure waste.
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const outcome = saveWorkspace(workspace);
      if (!outcome.ok) notify(outcome.message, { tone: 'error' });
    }, 400);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [workspace, notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ---- theme ----------------------------------------------------------------

  const [resolvedTheme, setResolvedTheme] = useState(() => applyTheme(workspace.theme));

  useEffect(() => {
    setResolvedTheme(applyTheme(workspace.theme));
    return watchSystemTheme(workspace.theme, () => setResolvedTheme(applyTheme(workspace.theme)));
  }, [workspace.theme]);

  // ---- selection ------------------------------------------------------------

  const selected = useMemo(
    () => workspace.methods.find((m) => m.id === workspace.selectedId) ?? null,
    [workspace],
  );

  const patchMethod = useCallback((id: string, patch: Partial<MethodDoc>) => {
    setWorkspace((ws) => ({
      ...ws,
      methods: ws.methods.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)),
    }));
  }, []);

  // ---- shared preamble ------------------------------------------------------

  // Registering the preamble as an extra lib makes its types visible to every
  // method's editor, matching what the compiler does at run time.
  useEffect(() => {
    const defaults = monaco.languages.typescript.typescriptDefaults;
    const content = workspace.preamble.replace(/^\s*export\s+/gm, '');
    defaults.setExtraLibs([{ content, filePath: PREAMBLE_URI }]);
  }, [workspace.preamble]);

  // ---- type diagnostics -----------------------------------------------------

  useEffect(() => {
    if (!selected || editingPreamble) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const uri = monaco.Uri.parse(`file:///${selected.name || selected.id}.ts`);
        const found = await getDiagnostics(uri);
        if (!cancelled) setDiagnostics((prev) => ({ ...prev, [selected.id]: found }));
      } catch {
        // The TS worker is not ready yet; the next edit will retry.
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, editingPreamble]);

  const jumpTo = useCallback((location: SourceLocation) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(location.line);
    editor.setPosition({ lineNumber: location.line, column: location.column });
    editor.focus();
  }, []);

  const onEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // ---- method lifecycle -----------------------------------------------------

  const createMethod = () => {
    const name = uniqueName(`method${workspace.methods.length + 1}`, workspace.methods);
    const method = newMethod({ name });
    method.code = `export function ${name}(input: string): string {\n  return input;\n}\n`;
    setWorkspace((ws) => ({ ...ws, methods: [...ws.methods, method], selectedId: method.id }));
    setEditingPreamble(false);
    setTab('run');
  };

  const duplicateMethod = (id: string) => {
    const source = workspace.methods.find((m) => m.id === id);
    if (!source) return;
    const copy: MethodDoc = {
      ...source,
      id: uid(),
      name: uniqueName(`${source.name}Copy`, workspace.methods),
      tests: source.tests.map((t) => ({ ...t, id: uid() })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setWorkspace((ws) => ({ ...ws, methods: [...ws.methods, copy], selectedId: copy.id }));
  };

  /** Delete straight away and offer an undo — a dialog you dismiss reflexively
   *  protects less than an undo you can actually use. */
  const deleteMethod = (id: string) => {
    const index = workspace.methods.findIndex((m) => m.id === id);
    if (index < 0) return;
    const removed = workspace.methods[index];
    const previousSelection = workspace.selectedId;

    setWorkspace((ws) => {
      const methods = ws.methods.filter((m) => m.id !== id);
      return {
        ...ws,
        methods,
        selectedId: ws.selectedId === id ? (methods[0]?.id ?? null) : ws.selectedId,
      };
    });

    notify(`Deleted ${removed.name}`, {
      action: {
        label: 'Undo',
        run: () =>
          setWorkspace((ws) => {
            const methods = [...ws.methods];
            methods.splice(Math.min(index, methods.length), 0, removed);
            return { ...ws, methods, selectedId: previousSelection };
          }),
      },
    });
  };

  // ---- running --------------------------------------------------------------

  const typeErrorsFor = (method: MethodDoc) =>
    (diagnostics[method.id] ?? []).filter((d) => d.severity === 'error');

  const doRun = useCallback(async () => {
    if (!selected) return;

    if (workspace.blockRunOnTypeError && typeErrorsFor(selected).length > 0) {
      notify('Blocked: this method has type errors.', { tone: 'error' });
      return;
    }

    setRunningRun(true);
    const result = await runMethod(
      selected,
      workspace.methods,
      workspace.preamble,
      selected.lastArgsExpr,
    );
    setRunResults((prev) => ({ ...prev, [selected.id]: result }));
    setWorkspace((ws) => ({
      ...ws,
      history: pushHistory(ws.history, selected.id, {
        id: uid(),
        argsExpr: selected.lastArgsExpr,
        timestamp: Date.now(),
        codeHash: hashCode(selected.code),
        result,
      }),
    }));
    setRunningRun(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, workspace.methods, workspace.preamble, workspace.blockRunOnTypeError, diagnostics, notify]);

  const runSingleTest = async (method: MethodDoc, test: TestCase) => {
    setRunningTests((prev) => new Set(prev).add(test.id));
    const [outcome] = await runTests(method, workspace.methods, workspace.preamble, [test]);
    setTestResults((prev) => ({
      ...prev,
      [method.id]: { ...(prev[method.id] ?? {}), [test.id]: outcome.result },
    }));
    setRunningTests((prev) => {
      const next = new Set(prev);
      next.delete(test.id);
      return next;
    });
  };

  const runAllTests = async (method: MethodDoc) => {
    const tests = method.tests.filter((t) => t.enabled);
    if (!tests.length) return;
    setRunningTests(new Set(tests.map((t) => t.id)));

    await runTests(
      method,
      workspace.methods,
      workspace.preamble,
      tests,
      undefined,
      ({ testId, result }) => {
        setTestResults((prev) => ({
          ...prev,
          [method.id]: { ...(prev[method.id] ?? {}), [testId]: result },
        }));
        setRunningTests((prev) => {
          const next = new Set(prev);
          next.delete(testId);
          return next;
        });
      },
    );

    setRunningTests(new Set());
  };

  const runEverything = async () => {
    let pass = 0;
    let fail = 0;

    for (const method of workspace.methods) {
      const tests = method.tests.filter((t) => t.enabled);
      if (!tests.length) continue;

      const outcomes = await runTests(method, workspace.methods, workspace.preamble, tests);
      setTestResults((prev) => ({
        ...prev,
        [method.id]: {
          ...(prev[method.id] ?? {}),
          ...Object.fromEntries(outcomes.map((o) => [o.testId, o.result])),
        },
      }));
      for (const outcome of outcomes) (isPass(outcome.result) ? pass++ : fail++);
    }

    notify(
      fail === 0 ? `All ${pass} test${pass === 1 ? '' : 's'} passing.` : `${pass} passing, ${fail} failing.`,
      fail ? { tone: 'error' } : {},
    );
  };

  // ---- test editing ---------------------------------------------------------

  const changeTest = (testId: string, patch: Partial<TestCase>) => {
    if (!selected) return;
    patchMethod(selected.id, {
      tests: selected.tests.map((t) => (t.id === testId ? { ...t, ...patch } : t)),
    });
  };

  const addTest = () => {
    if (!selected) return;
    const test = newTest({ name: `case ${selected.tests.length + 1}`, argsExpr: selected.lastArgsExpr });
    patchMethod(selected.id, { tests: [...selected.tests, test] });
    setTab('tests');
  };

  const deleteTest = (testId: string) => {
    if (!selected) return;
    const index = selected.tests.findIndex((t) => t.id === testId);
    if (index < 0) return;
    const removed = selected.tests[index];
    const methodId = selected.id;

    patchMethod(methodId, { tests: selected.tests.filter((t) => t.id !== testId) });
    notify(`Deleted case "${removed.name}"`, {
      action: {
        label: 'Undo',
        run: () =>
          setWorkspace((ws) => ({
            ...ws,
            methods: ws.methods.map((m) => {
              if (m.id !== methodId) return m;
              const tests = [...m.tests];
              tests.splice(Math.min(index, tests.length), 0, removed);
              return { ...m, tests };
            }),
          })),
      },
    });
  };

  /** Capture the last run as a new expectation — the fastest way to build a net. */
  const saveRunAsTest = () => {
    if (!selected) return;
    const result = runResults[selected.id];
    if (!result?.ok || !result.value) return;

    const test = newTest({
      name: `case ${selected.tests.length + 1}`,
      argsExpr: selected.lastArgsExpr,
      matcher: 'equals',
      expectedExpr: result.value.display,
    });
    patchMethod(selected.id, { tests: [...selected.tests, test] });
    setTestResults((prev) => ({
      ...prev,
      [selected.id]: { ...(prev[selected.id] ?? {}), [test.id]: { ...result, passed: true, phase: 'expect' } },
    }));
    setTab('tests');
    notify('Captured the current output as an expectation.');
  };

  const exportTests = () => {
    if (!selected) return;
    download(`${selected.name}.test.ts`, generateTestFile(selected, workspace.methods), 'text/typescript');
    notify(`Exported ${selected.name}.test.ts`);
  };

  // ---- import / export ------------------------------------------------------

  const exportWorkspace = () => {
    download(
      `ts-sandbox-${new Date().toISOString().slice(0, 10)}.json`,
      exportJson(workspace),
      'application/json',
    );
  };

  const exportMethod = () => {
    if (!selected) return;
    download(`${selected.name}.ts`, generateSourceFile(selected), 'text/typescript');
    notify(`Exported ${selected.name}.ts`);
  };

  /**
   * Accepts both shapes: a workspace `.json`, and a `.ts` file — whether it was
   * written by this app (metadata restored) or is any other TypeScript file
   * (name and description inferred, nothing blocking).
   */
  const doImport = async (files: File[]) => {
    const added: MethodDoc[] = [];
    let importedPreamble: string | undefined;
    const failures: string[] = [];
    let incomplete = 0;

    for (const file of files) {
      try {
        const text = await file.text();

        if (/\.json$/i.test(file.name)) {
          const parsed = importJson(text);
          added.push(...parsed.methods);
          importedPreamble ??= parsed.preamble;
        } else {
          const fallback = file.name.replace(/\.[^.]+$/, '');
          const partial = parseSourceFile(text, fallback);
          const method = newMethod({ ...partial, id: uid() });
          if (!method.description.trim() || method.tests.length === 0) incomplete++;
          added.push(method);
        }
      } catch (err) {
        failures.push(`${file.name}: ${(err as Error).message}`);
      }
    }

    // An imported preamble must never silently destroy one the user has written.
    // Adopting it is only safe while theirs is still the untouched default.
    const mine = workspace.preamble;
    const pristine = !mine.trim() || mine.trim() === DEFAULT_PREAMBLE.trim();
    const hasImported = importedPreamble !== undefined && importedPreamble !== mine;
    const conflict = hasImported && !pristine;
    const adopted = hasImported && !conflict ? importedPreamble : undefined;

    if (added.length) {
      setWorkspace((ws) => {
        const merged = [...ws.methods];
        for (const method of added) {
          merged.push({ ...method, name: uniqueName(method.name, merged) });
        }
        return {
          ...ws,
          methods: merged,
          preamble: adopted ?? ws.preamble,
          selectedId: added[0].id,
        };
      });
      setEditingPreamble(false);
    }

    if (failures.length) {
      notify(`Import failed — ${failures.join('; ')}`, { tone: 'error' });
      return;
    }

    const note = incomplete ? ` ${incomplete} still needs a description or tests.` : '';
    const counted = `Imported ${added.length} method${added.length === 1 ? '' : 's'}.${note}`;

    if (conflict) {
      // Offer the swap rather than performing it, and keep that undoable too.
      notify(`${counted} The file has a different preamble — yours was kept.`, {
        action: {
          label: 'Use theirs',
          run: () => {
            setWorkspace((ws) => ({ ...ws, preamble: importedPreamble as string }));
            notify('Preamble replaced.', {
              action: { label: 'Undo', run: () => setWorkspace((ws) => ({ ...ws, preamble: mine })) },
            });
          },
        },
      });
    } else {
      notify(counted);
    }
  };

  /**
   * Top up an existing library with any bundled examples it does not already
   * have. Workspaces saved before an example was added would otherwise never
   * see it, since the seeds only apply to a brand-new workspace.
   */
  const addExamples = () => {
    const additions = missingExamples(workspace.methods);
    if (!additions.length) {
      notify('Every bundled example is already in your library.');
      return;
    }

    const addedIds = new Set(additions.map((m) => m.id));
    setWorkspace((ws) => ({
      ...ws,
      methods: [...ws.methods, ...additions],
      selectedId: additions[0].id,
    }));
    setEditingPreamble(false);

    notify(`Added ${additions.length}: ${additions.map((m) => m.name).join(', ')}`, {
      action: {
        label: 'Undo',
        run: () =>
          setWorkspace((ws) => ({ ...ws, methods: ws.methods.filter((m) => !addedIds.has(m.id)) })),
      },
    });
  };

  const doReset = () => {
    const previous = workspace;
    setWorkspace(seedWorkspace());
    setRunResults({});
    setTestResults({});
    setDiagnostics({});
    notify('Workspace reset to the bundled examples.', {
      action: { label: 'Undo', run: () => setWorkspace(previous) },
    });
  };

  // ---- keyboard -------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (tab === 'tests' && selected) void runAllTests(selected);
        else void doRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doRun, tab, selected]);

  // ---- derived --------------------------------------------------------------

  const badges = useMemo(() => {
    const out: Record<string, MethodBadge> = {};
    for (const method of workspace.methods) {
      const results = testResults[method.id];
      if (!results) continue;
      let pass = 0;
      let fail = 0;
      for (const test of method.tests) {
        const result = results[test.id];
        if (!result) continue;
        isPass(result) ? pass++ : fail++;
      }
      out[method.id] = { pass, fail };
    }
    return out;
  }, [workspace.methods, testResults]);

  const errorCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, list] of Object.entries(diagnostics)) {
      out[id] = list.filter((d) => d.severity === 'error').length;
    }
    return out;
  }, [diagnostics]);

  const allTags = useMemo(
    () => [...new Set(workspace.methods.flatMap((m) => m.tags))].sort(),
    [workspace.methods],
  );

  const detected = selected ? detectEntryName(selected.code) : '';
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs';

  const editorOptions = {
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    automaticLayout: true,
    padding: { top: 12 },
  } as const;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>TS Sandbox</strong>
          <span className="hint">write · run · test TypeScript methods</span>
        </div>

        <div className="topbar-actions">
          <label className="toggle" title="Refuse to run a method that has type errors">
            <input
              type="checkbox"
              checked={workspace.blockRunOnTypeError}
              onChange={(e) => setWorkspace((ws) => ({ ...ws, blockRunOnTypeError: e.target.checked }))}
            />
            block on type errors
          </label>
          <button className="btn" onClick={runEverything} disabled={workspace.methods.length === 0}>
            ▶ Run all tests
          </button>
          <button
            className="btn"
            onClick={() =>
              setWorkspace((ws) => ({
                ...ws,
                theme: THEME_ORDER[(THEME_ORDER.indexOf(ws.theme) + 1) % THEME_ORDER.length],
              }))
            }
            aria-label={`Theme: ${workspace.theme}. Click to change.`}
          >
            {THEME_LABEL[workspace.theme]}
          </button>
          <ExportMenu
            methodName={editingPreamble ? null : (selected?.name ?? null)}
            onExportMethod={exportMethod}
            onExportWorkspace={exportWorkspace}
          />
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <button className="btn" onClick={addExamples} title="Add any bundled examples you do not have yet">
            Examples
          </button>
          <button className="btn" onClick={doReset}>
            Reset
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".ts,.tsx,.js,.json,application/json,text/plain"
            hidden
            aria-label="Import method (.ts) or workspace (.json) files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void doImport(files);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="body">
        <Sidebar
          methods={workspace.methods}
          selectedId={editingPreamble ? null : workspace.selectedId}
          query={query}
          activeTags={activeTags}
          badges={badges}
          errorCounts={errorCounts}
          preambleOpen={editingPreamble}
          onQueryChange={setQuery}
          onToggleTag={(tag) =>
            setActiveTags((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]))
          }
          onSelect={(id) => {
            setEditingPreamble(false);
            setWorkspace((ws) => ({ ...ws, selectedId: id }));
          }}
          onCreate={createMethod}
          onDuplicate={duplicateMethod}
          onDelete={deleteMethod}
          onOpenPreamble={() => setEditingPreamble(true)}
        />

        {editingPreamble ? (
          <main className="workarea">
            <div className="method-head">
              <span className="preamble-title">Shared preamble</span>
              <span className="hint">
                Prepended to every method at compile time, and visible to every editor.
              </span>
              <button
                className="btn"
                onClick={() => setWorkspace((ws) => ({ ...ws, preamble: DEFAULT_PREAMBLE }))}
              >
                Restore default
              </button>
            </div>
            <div className="editor-wrap">
              <Editor
                path={PREAMBLE_URI}
                language="typescript"
                theme={monacoTheme}
                value={workspace.preamble}
                onChange={(value) => setWorkspace((ws) => ({ ...ws, preamble: value ?? '' }))}
                options={editorOptions}
              />
            </div>
          </main>
        ) : selected ? (
          <>
            <main className="workarea">
              <div className="method-head">
                <input
                  className="title-input"
                  value={selected.name}
                  placeholder="method name"
                  aria-label="Method name"
                  onChange={(e) => patchMethod(selected.id, { name: e.target.value })}
                  onBlur={(e) => {
                    const unique = uniqueName(e.target.value.trim() || 'untitled', workspace.methods, selected.id);
                    if (unique !== selected.name) patchMethod(selected.id, { name: unique });
                  }}
                />
                <input
                  className="desc-input"
                  value={selected.description}
                  placeholder="what does it do?"
                  aria-label="Method description"
                  onChange={(e) => patchMethod(selected.id, { description: e.target.value })}
                />
                <label className="entry-field" title="Which function the sandbox calls">
                  entry
                  <input
                    value={selected.entryName}
                    placeholder={detected || 'auto'}
                    aria-label="Entry function override"
                    onChange={(e) => patchMethod(selected.id, { entryName: e.target.value })}
                  />
                </label>
              </div>

              <div className="tag-bar">
                <TagEditor
                  tags={selected.tags}
                  suggestions={allTags}
                  onChange={(tags) => patchMethod(selected.id, { tags })}
                />
              </div>

              <div className="editor-wrap">
                <Editor
                  path={`file:///${selected.name || selected.id}.ts`}
                  language="typescript"
                  theme={monacoTheme}
                  value={selected.code}
                  onMount={onEditorMount}
                  onChange={(value) => patchMethod(selected.id, { code: value ?? '' })}
                  options={editorOptions}
                />
              </div>
            </main>

            <aside className="panel">
              <div className="tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === 'run'}
                  className={tab === 'run' ? 'tab active' : 'tab'}
                  onClick={() => setTab('run')}
                >
                  Run
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'tests'}
                  className={tab === 'tests' ? 'tab active' : 'tab'}
                  onClick={() => setTab('tests')}
                >
                  Tests <span className="count">{selected.tests.length}</span>
                </button>
              </div>

              {tab === 'run' ? (
                <RunPanel
                  method={selected}
                  result={runResults[selected.id] ?? null}
                  history={workspace.history[selected.id] ?? []}
                  diagnostics={diagnostics[selected.id] ?? []}
                  currentCodeHash={hashCode(selected.code)}
                  running={runningRun}
                  onPatch={(patch) => patchMethod(selected.id, patch)}
                  onRun={doRun}
                  onSaveAsTest={saveRunAsTest}
                  onJumpTo={jumpTo}
                  onClearHistory={() =>
                    setWorkspace((ws) => ({ ...ws, history: { ...ws.history, [selected.id]: [] } }))
                  }
                />
              ) : (
                <TestsPanel
                  method={selected}
                  results={testResults[selected.id] ?? {}}
                  runningIds={runningTests}
                  onChangeTest={changeTest}
                  onAddTest={addTest}
                  onDeleteTest={deleteTest}
                  onRunTest={(testId) => {
                    const test = selected.tests.find((t) => t.id === testId);
                    if (test) void runSingleTest(selected, test);
                  }}
                  onRunAll={() => void runAllTests(selected)}
                  onExportTests={exportTests}
                  onJumpTo={jumpTo}
                />
              )}
            </aside>
          </>
        ) : (
          <div className="blank-slate">
            <p>No method selected.</p>
            <button className="btn primary" onClick={createMethod}>
              + New method
            </button>
          </div>
        )}
      </div>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
