import type { SandboxResult } from '../types';

const PHASE_LABEL: Record<SandboxResult['phase'], string> = {
  compile: 'Compile error',
  entry: 'Entry point',
  args: 'Arguments',
  call: 'Threw',
  expect: 'Expectation',
  timeout: 'Timed out',
};

export default function ResultView({ result, compact }: { result: SandboxResult; compact?: boolean }) {
  const failed = !result.ok;

  return (
    <div className="result">
      {failed && result.error && (
        <section className="result-block error">
          <h4>
            {PHASE_LABEL[result.phase]} · {result.error.name}
          </h4>
          <pre>{result.error.message}</pre>
          {result.error.stack && !compact && (
            <details>
              <summary>stack</summary>
              <pre className="stack">{result.error.stack}</pre>
            </details>
          )}
        </section>
      )}

      {result.expected && (
        <section className="result-block">
          <h4>Expected</h4>
          <pre>{result.expected.display}</pre>
        </section>
      )}

      {result.value && (
        <section className="result-block">
          <h4>
            {result.expected ? 'Received' : 'Returned'} <span className="type-tag">{result.value.type}</span>
          </h4>
          <pre>{result.value.display}</pre>
        </section>
      )}

      {result.thrown && result.ok && (
        <section className="result-block">
          <h4>Threw</h4>
          <pre>{result.thrown.display}</pre>
        </section>
      )}

      {result.logs.length > 0 && (
        <section className="result-block">
          <h4>Console ({result.logs.length})</h4>
          <div className="console">
            {result.logs.map((line, i) => (
              <div key={i} className={`log ${line.level}`}>
                <span className="log-level">{line.level}</span>
                <span className="log-text">{line.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="result-foot">{result.durationMs}ms</div>
    </div>
  );
}
