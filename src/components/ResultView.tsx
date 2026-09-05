import type { Difference, SandboxResult, SourceLocation } from '../types';

const PHASE_LABEL: Record<SandboxResult['phase'], string> = {
  compile: 'Compile error',
  resolve: 'Import problem',
  entry: 'Entry point',
  args: 'Arguments',
  call: 'Threw',
  expect: 'Expectation',
  timeout: 'Timed out',
};

interface Props {
  result: SandboxResult;
  compact?: boolean;
  onJumpTo?: (location: SourceLocation) => void;
}

/** Highlight only the part of two strings that actually differs. */
function StringDiff({ difference }: { difference: Difference }) {
  const diff = difference.stringDiff;
  if (!diff) return null;

  // Displays are quoted by the formatter; work on the raw slices instead.
  const expected = difference.expected.display;
  const actual = difference.actual.display;
  const head = expected.slice(0, diff.prefix + 1);
  const tail = diff.suffix ? expected.slice(expected.length - diff.suffix - 1) : '"';

  return (
    <div className="string-diff">
      <div className="string-diff-row">
        <span className="diff-tag expected">expected</span>
        <code>
          <span className="diff-same">{head}</span>
          <span className="diff-expected">{diff.expectedMiddle}</span>
          <span className="diff-same">{tail}</span>
        </code>
      </div>
      <div className="string-diff-row">
        <span className="diff-tag actual">received</span>
        <code>
          <span className="diff-same">{actual.slice(0, diff.prefix + 1)}</span>
          <span className="diff-actual">{diff.actualMiddle}</span>
          <span className="diff-same">{tail}</span>
        </code>
      </div>
    </div>
  );
}

function DifferenceBlock({ difference }: { difference: Difference }) {
  return (
    <section className="result-block difference">
      <h4>
        First difference <span className="diff-path">{difference.path}</span>
      </h4>
      {difference.stringDiff ? (
        <StringDiff difference={difference} />
      ) : (
        <div className="diff-pair">
          <div>
            <span className="diff-tag expected">expected</span>
            <pre>{difference.expected.display}</pre>
          </div>
          <div>
            <span className="diff-tag actual">received</span>
            <pre>{difference.actual.display}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

export default function ResultView({ result, compact, onJumpTo }: Props) {
  const failed = !result.ok;
  const location = result.error?.location;

  return (
    <div className="result">
      {failed && result.error && (
        <section className="result-block error">
          <h4>
            {PHASE_LABEL[result.phase]} · {result.error.name}
          </h4>
          <pre>{result.error.message}</pre>

          {location && (
            <button
              className="location-link"
              onClick={() => onJumpTo?.(location)}
              disabled={!onJumpTo || location.source === 'preamble'}
              aria-label={`Go to ${location.source} line ${location.line}`}
            >
              {location.source}.ts:{location.line}:{location.column}
            </button>
          )}

          {result.error.stack && !compact && (
            <details>
              <summary>stack</summary>
              <pre className="stack">{result.error.stack}</pre>
            </details>
          )}
        </section>
      )}

      {result.difference && <DifferenceBlock difference={result.difference} />}

      {result.expected && !result.difference && (
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
