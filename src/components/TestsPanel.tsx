import { useState } from 'react';
import { isPass } from '../lib/runner';
import type { Matcher, MethodDoc, SandboxResult, TestCase } from '../types';
import ResultView from './ResultView';

interface Props {
  method: MethodDoc;
  results: Record<string, SandboxResult>;
  runningIds: Set<string>;
  onChangeTest: (testId: string, patch: Partial<TestCase>) => void;
  onAddTest: () => void;
  onDeleteTest: (testId: string) => void;
  onRunTest: (testId: string) => void;
  onRunAll: () => void;
}

const MATCHERS: { value: Matcher; label: string; hint: string }[] = [
  { value: 'equals', label: 'equals', hint: 'Deep equality against the expected value' },
  { value: 'throws', label: 'throws', hint: 'Must throw; expected text is matched as a substring of the message' },
  { value: 'truthy', label: 'truthy', hint: 'Return value must be truthy' },
  { value: 'any', label: 'runs', hint: 'Passes as long as nothing throws' },
];

function statusOf(result: SandboxResult | undefined, running: boolean): 'running' | 'pass' | 'fail' | 'idle' {
  if (running) return 'running';
  if (!result) return 'idle';
  return isPass(result) ? 'pass' : 'fail';
}

export default function TestsPanel({
  method,
  results,
  runningIds,
  onChangeTest,
  onAddTest,
  onDeleteTest,
  onRunTest,
  onRunAll,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const enabled = method.tests.filter((t) => t.enabled);
  const scored = enabled.filter((t) => results[t.id]);
  const passing = scored.filter((t) => isPass(results[t.id])).length;

  return (
    <div className="panel-body">
      <div className="row">
        <button className="btn primary" onClick={onRunAll} disabled={runningIds.size > 0 || enabled.length === 0}>
          {runningIds.size > 0 ? 'Running…' : `▶ Run all (${enabled.length})`}
        </button>
        <button className="btn" onClick={onAddTest}>
          + Add case
        </button>
        {scored.length > 0 && (
          <span className={`summary ${passing === scored.length ? 'good' : 'bad'}`}>
            {passing}/{scored.length} passing
          </span>
        )}
      </div>

      {method.tests.length === 0 && (
        <p className="empty">
          No test cases yet. Add one here, or run the method and press “Save as test case” to capture its current
          output as the expectation.
        </p>
      )}

      <div className="test-list">
        {method.tests.map((test) => {
          const result = results[test.id];
          const status = statusOf(result, runningIds.has(test.id));
          const isOpen = open[test.id] ?? false;

          return (
            <div key={test.id} className={`test-card ${status}`}>
              <div className="test-head">
                <input
                  type="checkbox"
                  checked={test.enabled}
                  title={test.enabled ? 'Included in Run all' : 'Skipped'}
                  onChange={(e) => onChangeTest(test.id, { enabled: e.target.checked })}
                />
                <span className={`chip ${status}`}>
                  {status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'running' ? '···' : '—'}
                </span>
                <input
                  className="test-name"
                  value={test.name}
                  placeholder="describe this case"
                  onChange={(e) => onChangeTest(test.id, { name: e.target.value })}
                />
                <button className="icon" title="Run this case" onClick={() => onRunTest(test.id)}>
                  ▶
                </button>
                <button className="icon" title={isOpen ? 'Collapse' : 'Edit'} onClick={() => setOpen((o) => ({ ...o, [test.id]: !isOpen }))}>
                  {isOpen ? '▴' : '▾'}
                </button>
                <button
                  className="icon danger"
                  title="Delete case"
                  onClick={() => onDeleteTest(test.id)}
                >
                  ✕
                </button>
              </div>

              {isOpen && (
                <div className="test-body">
                  <div className="field">
                    <label>
                      Arguments <span className="hint">JS array</span>
                    </label>
                    <textarea
                      className="code-input"
                      spellCheck={false}
                      value={test.argsExpr}
                      onChange={(e) => onChangeTest(test.id, { argsExpr: e.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label>Matcher</label>
                    <select
                      value={test.matcher}
                      onChange={(e) => onChangeTest(test.id, { matcher: e.target.value as Matcher })}
                    >
                      {MATCHERS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <span className="hint">{MATCHERS.find((m) => m.value === test.matcher)?.hint}</span>
                  </div>

                  {(test.matcher === 'equals' || test.matcher === 'throws') && (
                    <div className="field">
                      <label>
                        {test.matcher === 'throws' ? 'Error message contains' : 'Expected'}
                        <span className="hint">{test.matcher === 'throws' ? 'plain text' : 'JS expression'}</span>
                      </label>
                      <textarea
                        className="code-input"
                        spellCheck={false}
                        value={test.expectedExpr}
                        onChange={(e) => onChangeTest(test.id, { expectedExpr: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              {result && (isOpen || !isPass(result)) && <ResultView result={result} compact />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
