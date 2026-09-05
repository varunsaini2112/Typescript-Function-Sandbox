import { useMemo } from 'react';
import { detectParams } from '../lib/compile';
import { entryFor } from '../lib/runner';
import type { MethodDoc, SandboxResult } from '../types';
import ResultView from './ResultView';

interface Props {
  method: MethodDoc;
  result: SandboxResult | null;
  running: boolean;
  onArgsChange: (value: string) => void;
  onRun: () => void;
  onSaveAsTest: () => void;
}

export default function RunPanel({ method, result, running, onArgsChange, onRun, onSaveAsTest }: Props) {
  const entry = entryFor(method);
  const params = useMemo(() => detectParams(method.code, entry), [method.code, entry]);

  return (
    <div className="panel-body">
      <div className="field">
        <label>
          Arguments
          <span className="hint">
            JS array passed to <code>{entry || '?'}</code>
            {params.length ? ` (${params.join(', ')})` : ''}
          </span>
        </label>
        <textarea
          className="code-input args"
          spellCheck={false}
          value={method.lastArgsExpr}
          onChange={(e) => onArgsChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onRun();
            }
          }}
          placeholder='[1, "two", { three: true }]'
        />
      </div>

      <div className="row">
        <button className="btn primary" onClick={onRun} disabled={running}>
          {running ? 'Running…' : '▶ Run'}
        </button>
        <button className="btn" onClick={onSaveAsTest} disabled={!result || !result.ok}>
          Save as test case
        </button>
        <span className="hint right">⌘/Ctrl + Enter</span>
      </div>

      {result ? (
        <ResultView result={result} />
      ) : (
        <p className="empty">Run the method to see its return value, console output and timing.</p>
      )}
    </div>
  );
}
