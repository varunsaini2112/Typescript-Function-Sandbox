import { useState } from 'react';
import { isPass } from '../lib/runner';
import { useBusyIndicator } from '../lib/useBusy';
import type { Matcher, MethodDoc, SandboxResult, SourceLocation, TestCase } from '../types';
import ResultView from './ResultView';
import CountUp from './CountUp';

interface Props {
  method: MethodDoc;
  results: Record<string, SandboxResult>;
  runningIds: Set<string>;
  onChangeTest: (testId: string, patch: Partial<TestCase>) => void;
  onAddTest: () => void;
  onDeleteTest: (testId: string) => void;
  onRunTest: (testId: string) => void;
  onRunAll: () => void;
  onExportTests: () => void;
  onJumpTo: (location: SourceLocation) => void;
}

const MATCHERS: { value: Matcher; label: string; hint: string }[] = [
  { value: 'equals', label: 'equals', hint: 'Deep equality against the expected value' },
  { value: 'throws', label: 'throws', hint: 'Must throw; expected text is matched as a substring of the message' },
  { value: 'truthy', label: 'truthy', hint: 'Return value must be truthy' },
  {
    value: 'snapshot',
    label: 'snapshot',
    hint: 'Formatted output must match exactly — works for values no expression can express',
  },
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
  onExportTests,
  onJumpTo,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const showProgress = useBusyIndicator(runningIds.size > 0);

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
        <button
          className="btn"
          onClick={onExportTests}
          disabled={method.tests.length === 0}
          title="Download a Vitest file for these cases"
        >
          Export
        </button>
        {scored.length > 0 && (
          <span
            key={`${passing}-${scored.length}`}
            className={`summary ${passing === scored.length ? 'good' : 'bad'}`}
          >
            <CountUp value={passing} />/{scored.length} passing
          </span>
        )}
      </div>

      {showProgress && <div className="running-bar" aria-label="Running tests" />}

      {method.tests.length === 0 && (
        <p className="empty">
          No test cases yet. Add one here, or run the method and press “Save as test case” to capture its current
          output as the expectation.
        </p>
      )}

      <div className="test-list">
        {method.tests.map((test, index) => {
          const result = results[test.id];
          const status = statusOf(result, runningIds.has(test.id));
          const isOpen = open[test.id] ?? false;

          return (
            <div key={test.id} className={`test-card ${status}`}>
              <div className="test-head">
                <input
                  type="checkbox"
                  checked={test.enabled}
                  aria-label={`Include "${test.name}" when running all`}
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
                  aria-label="Test case name"
                  onChange={(e) => onChangeTest(test.id, { name: e.target.value })}
                />
                <button className="icon" aria-label={`Run "${test.name}"`} title="Run this case" onClick={() => onRunTest(test.id)}>
                  ▶
                </button>
                <button
                  className="icon"
                  aria-label={isOpen ? 'Collapse case' : 'Edit case'}
                  aria-expanded={isOpen}
                  title={isOpen ? 'Collapse' : 'Edit'}
                  onClick={() => setOpen((o) => ({ ...o, [test.id]: !isOpen }))}
                >
                  {isOpen ? '▴' : '▾'}
                </button>
                <button
                  className="icon danger"
                  aria-label={`Delete "${test.name}"`}
                  title="Delete case"
                  onClick={() => onDeleteTest(test.id)}
                >
                  ✕
                </button>
              </div>

              {isOpen && (
                <div className="test-body">
                  <div className="field">
                    <label htmlFor={`args-${test.id}`}>
                      Arguments <span className="hint">JS array</span>
                    </label>
                    <textarea
                      id={`args-${test.id}`}
                      className="code-input"
                      spellCheck={false}
                      value={test.argsExpr}
                      onChange={(e) => onChangeTest(test.id, { argsExpr: e.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor={`matcher-${test.id}`}>Matcher</label>
                    <select
                      id={`matcher-${test.id}`}
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

                  {(test.matcher === 'equals' || test.matcher === 'throws' || test.matcher === 'snapshot') && (
                    <div className="field">
                      <label htmlFor={`expected-${test.id}`}>
                        {test.matcher === 'throws'
                          ? 'Error message contains'
                          : test.matcher === 'snapshot'
                            ? 'Expected output'
                            : 'Expected'}
                        <span className="hint">
                          {test.matcher === 'throws'
                            ? 'plain text'
                            : test.matcher === 'snapshot'
                              ? 'formatted output, compared exactly'
                              : 'JS expression'}
                        </span>
                      </label>
                      <textarea
                        id={`expected-${test.id}`}
                        className="code-input"
                        spellCheck={false}
                        value={test.expectedExpr}
                        onChange={(e) => onChangeTest(test.id, { expectedExpr: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}

              {result && (isOpen || !isPass(result)) && (
                // Keyed by duration so a re-run replays the reveal, staggered
                // down the list so a suite lands as a cascade rather than a jump.
                <div
                  key={`${test.id}-${result.durationMs}`}
                  className="reveal"
                  style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                >
                  <ResultView result={result} compact onJumpTo={onJumpTo} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
