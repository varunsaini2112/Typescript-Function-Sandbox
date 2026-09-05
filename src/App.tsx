import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import Sidebar, { type MethodBadge } from './components/Sidebar';
import RunPanel from './components/RunPanel';
import TestsPanel from './components/TestsPanel';
import { detectEntryName } from './lib/compile';
import { isPass, runMethod, runTests } from './lib/runner';
import {
  exportJson,
  importJson,
  loadWorkspace,
  newMethod,
  newTest,
  saveWorkspace,
  seedWorkspace,
  uid,
} from './lib/storage';
import type { MethodDoc, SandboxResult, TestCase, Workspace } from './types';

type ResultsByMethod = Record<string, Record<string, SandboxResult>>;

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace());
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'run' | 'tests'>('run');
  const [runResults, setRunResults] = useState<Record<string, SandboxResult>>({});
  const [testResults, setTestResults] = useState<ResultsByMethod>({});
  const [runningRun, setRunningRun] = useState(false);
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

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

  // ---- method lifecycle -----------------------------------------------------

  const createMethod = () => {
    const method = newMethod({ name: `method${workspace.methods.length + 1}` });
    method.code = `export function ${method.name}(input: string): string {\n  return input;\n}\n`;
    setWorkspace((ws) => ({ ...ws, methods: [...ws.methods, method], selectedId: method.id }));
    setTab('run');
  };

  const duplicateMethod = (id: string) => {
    const source = workspace.methods.find((m) => m.id === id);
    if (!source) return;
    const copy: MethodDoc = {
      ...source,
      id: uid(),
      name: `${source.name}-copy`,
      tests: source.tests.map((t) => ({ ...t, id: uid() })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setWorkspace((ws) => ({ ...ws, methods: [...ws.methods, copy], selectedId: copy.id }));
  };

  const deleteMethod = (id: string) => {
    setWorkspace((ws) => {
      const methods = ws.methods.filter((m) => m.id !== id);
      return {
        ...ws,
        methods,
        selectedId: ws.selectedId === id ? (methods[0]?.id ?? null) : ws.selectedId,
      };
    });
  };

  // ---- running --------------------------------------------------------------

  const doRun = useCallback(async () => {
    if (!selected) return;
    setRunningRun(true);
    const result = await runMethod(selected, selected.lastArgsExpr);
    setRunResults((prev) => ({ ...prev, [selected.id]: result }));
    setRunningRun(false);
  }, [selected]);

  const runSingleTest = async (method: MethodDoc, test: TestCase) => {
    setRunningTests((prev) => new Set(prev).add(test.id));
    const [outcome] = await runTests(method, [test]);
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

    await runTests(method, tests, undefined, ({ testId, result }) => {
      setTestResults((prev) => ({
        ...prev,
        [method.id]: { ...(prev[method.id] ?? {}), [testId]: result },
      }));
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(testId);
        return next;
      });
    });

    setRunningTests(new Set());
  };

  const runEverything = async () => {
    let pass = 0;
    let fail = 0;
    for (const method of workspace.methods) {
      const tests = method.tests.filter((t) => t.enabled);
      if (!tests.length) continue;
      const outcomes = await runTests(method, tests);
      setTestResults((prev) => ({
        ...prev,
        [method.id]: {
          ...(prev[method.id] ?? {}),
          ...Object.fromEntries(outcomes.map((o) => [o.testId, o.result])),
        },
      }));
      for (const o of outcomes) (isPass(o.result) ? pass++ : fail++);
    }
    setToast(fail === 0 ? `All ${pass} test${pass === 1 ? '' : 's'} passing.` : `${pass} passing, ${fail} failing.`);
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
    patchMethod(selected.id, { tests: selected.tests.filter((t) => t.id !== testId) });
  };

  /** Capture the last run as a new expectation — the fastest way to build a regression net. */
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
    setToast('Captured the current output as an expectation.');
  };

  // ---- import / export ------------------------------------------------------

  const doExport = () => {
    const blob = new Blob([exportJson(workspace)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ts-sandbox-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    try {
      const methods = importJson(await file.text());
      setWorkspace((ws) => ({ ...ws, methods: [...ws.methods, ...methods], selectedId: methods[0]?.id ?? ws.selectedId }));
      setToast(`Imported ${methods.length} method${methods.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setToast(`Import failed: ${(err as Error).message}`);
    }
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
  }, [doRun, tab, selected]);

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

  const detected = selected ? detectEntryName(selected.code) : '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>TS Sandbox</strong>
          <span className="hint">write · run · test TypeScript methods</span>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={runEverything} disabled={workspace.methods.length === 0}>
            ▶ Run all tests
          </button>
          <button className="btn" onClick={doExport}>
            Export
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Reset the workspace to the bundled examples? Your current methods will be lost.')) {
                setWorkspace(seedWorkspace());
                setRunResults({});
                setTestResults({});
              }
            }}
          >
            Reset
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="body">
        <Sidebar
          methods={workspace.methods}
          selectedId={workspace.selectedId}
          query={query}
          badges={badges}
          onQueryChange={setQuery}
          onSelect={(id) => setWorkspace((ws) => ({ ...ws, selectedId: id }))}
          onCreate={createMethod}
          onDuplicate={duplicateMethod}
          onDelete={deleteMethod}
        />

        {selected ? (
          <>
            <main className="workarea">
              <div className="method-head">
                <input
                  className="title-input"
                  value={selected.name}
                  placeholder="method name"
                  onChange={(e) => patchMethod(selected.id, { name: e.target.value })}
                />
                <input
                  className="desc-input"
                  value={selected.description}
                  placeholder="what does it do?"
                  onChange={(e) => patchMethod(selected.id, { description: e.target.value })}
                />
                <label className="entry-field" title="Which function the sandbox calls">
                  entry
                  <input
                    value={selected.entryName}
                    placeholder={detected || 'auto'}
                    onChange={(e) => patchMethod(selected.id, { entryName: e.target.value })}
                  />
                </label>
              </div>

              <div className="editor-wrap">
                <Editor
                  path={`file:///${selected.id}.ts`}
                  language="typescript"
                  theme="vs-dark"
                  value={selected.code}
                  onChange={(value) => patchMethod(selected.id, { code: value ?? '' })}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    tabSize: 2,
                    automaticLayout: true,
                    padding: { top: 12 },
                  }}
                />
              </div>
            </main>

            <aside className="panel">
              <div className="tabs">
                <button className={tab === 'run' ? 'tab active' : 'tab'} onClick={() => setTab('run')}>
                  Run
                </button>
                <button className={tab === 'tests' ? 'tab active' : 'tab'} onClick={() => setTab('tests')}>
                  Tests <span className="count">{selected.tests.length}</span>
                </button>
              </div>

              {tab === 'run' ? (
                <RunPanel
                  method={selected}
                  result={runResults[selected.id] ?? null}
                  running={runningRun}
                  onArgsChange={(value) => patchMethod(selected.id, { lastArgsExpr: value })}
                  onRun={doRun}
                  onSaveAsTest={saveRunAsTest}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
