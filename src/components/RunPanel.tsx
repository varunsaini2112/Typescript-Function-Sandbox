import { useEffect, useMemo, useRef, useState } from 'react';
import { detectParams, splitTopLevel } from '../lib/compile';
import { entryFor } from '../lib/runner';
import type { MethodDoc, RunHistoryEntry, SandboxResult, SourceLocation, TypeDiagnostic } from '../types';
import ResultView from './ResultView';

interface Props {
  method: MethodDoc;
  result: SandboxResult | null;
  history: RunHistoryEntry[];
  diagnostics: TypeDiagnostic[];
  currentCodeHash: string;
  running: boolean;
  onPatch: (patch: Partial<MethodDoc>) => void;
  onRun: () => void;
  onSaveAsTest: () => void;
  onJumpTo: (location: SourceLocation) => void;
  onClearHistory: () => void;
}

/** Compose the stored array expression from the per-parameter fields. */
export function joinArgs(values: string[]): string {
  const filled = [...values];
  while (filled.length && filled[filled.length - 1].trim() === '') filled.pop();
  return `[${filled.map((value) => (value.trim() === '' ? 'undefined' : value.trim())).join(', ')}]`;
}

/** Best-effort split of an array expression back into per-parameter fields. */
export function splitArgs(expr: string): string[] | null {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  return inner === '' ? [] : splitTopLevel(inner);
}

export default function RunPanel({
  method,
  result,
  history,
  diagnostics,
  currentCodeHash,
  running,
  onPatch,
  onRun,
  onSaveAsTest,
  onJumpTo,
  onClearHistory,
}: Props) {
  const [showHistory, setShowHistory] = useState(false);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  // Briefly tint the button itself, so the outcome registers where the eye already is.
  const [flash, setFlash] = useState<'' | 'flash-pass' | 'flash-fail'>('');
  const lastResult = useRef<SandboxResult | null>(null);

  useEffect(() => {
    if (!result || result === lastResult.current) return;
    lastResult.current = result;
    setFlash(result.ok ? 'flash-pass' : 'flash-fail');
    const timer = setTimeout(() => setFlash(''), 700);
    return () => clearTimeout(timer);
  }, [result]);

  const entry = entryFor(method);
  const params = useMemo(() => detectParams(method.code, entry), [method.code, entry]);

  // Rest parameters have no fixed arity, so the raw array is the honest editor.
  const canUseFields = params.length > 0 && !params.some((param) => param.rest);
  const mode = canUseFields ? method.argsMode : 'raw';

  const values = useMemo(() => {
    const stored = method.lastArgs.length ? method.lastArgs : (splitArgs(method.lastArgsExpr) ?? []);
    return params.map((_, index) => stored[index] ?? '');
  }, [method.lastArgs, method.lastArgsExpr, params]);

  const setValue = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onPatch({ lastArgs: next, lastArgsExpr: joinArgs(next) });
  };

  const switchMode = (next: 'fields' | 'raw') => {
    if (next === 'fields') {
      const parsed = splitArgs(method.lastArgsExpr);
      onPatch({ argsMode: 'fields', lastArgs: parsed ?? method.lastArgs });
    } else {
      onPatch({ argsMode: 'raw', lastArgsExpr: method.lastArgs.length ? joinArgs(values) : method.lastArgsExpr });
    }
  };

  const errors = diagnostics.filter((d) => d.severity === 'error');

  const runOnKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
  };

  return (
    <div className="panel-body">
      {errors.length > 0 && (
        <details className="diagnostics">
          <summary>
            <span className="chip fail">{errors.length}</span>
            type error{errors.length === 1 ? '' : 's'} — types are erased, so this still runs
          </summary>
          <ul>
            {errors.map((diagnostic, i) => (
              <li key={i}>
                <button
                  className="location-link"
                  onClick={() => onJumpTo({ source: method.name, line: diagnostic.line, column: diagnostic.column })}
                  aria-label={`Go to line ${diagnostic.line}`}
                >
                  {diagnostic.line}:{diagnostic.column}
                </button>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="field">
        <label htmlFor={canUseFields && mode === 'fields' ? undefined : 'args-raw'}>
          Arguments
          <span className="hint">
            passed to <code>{entry || '?'}</code>
          </span>
          {canUseFields && (
            <span className="mode-switch">
              <button
                className={mode === 'fields' ? 'mini active' : 'mini'}
                onClick={() => switchMode('fields')}
                aria-pressed={mode === 'fields'}
              >
                fields
              </button>
              <button
                className={mode === 'raw' ? 'mini active' : 'mini'}
                onClick={() => switchMode('raw')}
                aria-pressed={mode === 'raw'}
              >
                raw
              </button>
            </span>
          )}
        </label>

        {mode === 'fields' ? (
          <div className="param-grid">
            {params.map((param, index) => (
              <div className="param-row" key={param.name + index}>
                <label className="param-name" htmlFor={`param-${index}`}>
                  {param.name}
                  {param.optional && <span className="param-optional">?</span>}
                </label>
                <input
                  id={`param-${index}`}
                  className="code-input param-input"
                  spellCheck={false}
                  value={values[index] ?? ''}
                  placeholder={param.optional ? 'default' : 'value'}
                  onChange={(e) => setValue(index, e.target.value)}
                  onKeyDown={runOnKey}
                />
              </div>
            ))}
          </div>
        ) : (
          <textarea
            id="args-raw"
            className="code-input args"
            spellCheck={false}
            value={method.lastArgsExpr}
            onChange={(e) => onPatch({ lastArgsExpr: e.target.value })}
            onKeyDown={runOnKey}
            placeholder='[1, "two", { three: true }]'
          />
        )}
      </div>

      <div className="row">
        <button className={`btn primary ${flash}`} onClick={onRun} disabled={running}>
          {running ? 'Running…' : '▶ Run'}
        </button>
        <button className="btn" onClick={onSaveAsTest} disabled={!result || !result.ok}>
          Save as test case
        </button>
        <span className="hint right">⌘/Ctrl + Enter</span>
      </div>

      {result ? (
        <ResultView result={result} onJumpTo={onJumpTo} />
      ) : (
        <p className="empty">Run the method to see its return value, console output and timing.</p>
      )}

      {history.length > 0 && (
        <div className="history">
          <div className="history-head">
            <button
              className="mini"
              onClick={() => setShowHistory((open) => !open)}
              aria-expanded={showHistory}
            >
              {showHistory ? '▾' : '▸'} History ({history.length})
            </button>
            {showHistory && (
              <button className="mini" onClick={onClearHistory}>
                clear
              </button>
            )}
          </div>

          {showHistory &&
            history.map((entry) => {
              const stale = entry.codeHash !== currentCodeHash;
              const isOpen = openEntry === entry.id;
              return (
                <div key={entry.id} className={`history-entry ${stale ? 'stale' : ''}`}>
                  <button
                    className="history-row"
                    onClick={() => setOpenEntry(isOpen ? null : entry.id)}
                    aria-expanded={isOpen}
                  >
                    <span className={`chip ${entry.result.ok ? 'pass' : 'fail'}`}>
                      {entry.result.ok ? 'OK' : 'ERR'}
                    </span>
                    <span className="history-args">{entry.argsExpr.replace(/\s+/g, ' ').slice(0, 40)}</span>
                    <span className="history-time">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                      {stale && <span className="stale-tag">code changed</span>}
                    </span>
                  </button>
                  {isOpen && <ResultView result={entry.result} compact />}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
