import SandboxWorker from './sandbox.worker?worker';
import { compile, detectEntryName } from './compile';
import type { Expectation, MethodDoc, SandboxResult, TestCase } from '../types';

export const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Run one call in a throwaway worker. A fresh worker per call means an infinite
 * loop can be killed by terminating it, and no state leaks between runs.
 */
function runCompiled(
  js: string,
  entryName: string,
  argsExpr: string,
  expectation: Expectation | undefined,
  timeoutMs: number,
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const worker = new SandboxWorker();
    const started = performance.now();
    let settled = false;

    const done = (result: SandboxResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({
        ok: false,
        phase: 'timeout',
        passed: false,
        logs: [],
        durationMs: timeoutMs,
        error: {
          name: 'Timeout',
          message: `Execution exceeded ${timeoutMs}ms and was aborted. Check for an infinite loop.`,
        },
      });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<SandboxResult>) => done(event.data);
    worker.onerror = (event) => {
      done({
        ok: false,
        phase: 'call',
        passed: false,
        logs: [],
        durationMs: Math.round(performance.now() - started),
        error: { name: 'WorkerError', message: event.message || 'The sandbox worker crashed.' },
      });
    };

    worker.postMessage({ js, entryName, argsExpr, expectation });
  });
}

function compileFailure(errors: string[]): SandboxResult {
  return {
    ok: false,
    phase: 'compile',
    passed: false,
    logs: [],
    durationMs: 0,
    error: { name: 'CompileError', message: errors.join('\n') },
  };
}

export function entryFor(method: MethodDoc): string {
  return method.entryName.trim() || detectEntryName(method.code);
}

export async function runMethod(
  method: MethodDoc,
  argsExpr: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SandboxResult> {
  const { js, errors } = compile(method.code);
  if (errors.length) return compileFailure(errors);
  return runCompiled(js, entryFor(method), argsExpr, undefined, timeoutMs);
}

export interface TestOutcome {
  testId: string;
  result: SandboxResult;
}

export async function runTests(
  method: MethodDoc,
  tests: TestCase[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onResult?: (outcome: TestOutcome) => void,
): Promise<TestOutcome[]> {
  const { js, errors } = compile(method.code);
  const entryName = entryFor(method);
  const outcomes: TestOutcome[] = [];

  for (const test of tests) {
    const result = errors.length
      ? compileFailure(errors)
      : await runCompiled(
          js,
          entryName,
          test.argsExpr,
          { matcher: test.matcher, expectedExpr: test.expectedExpr },
          timeoutMs,
        );
    const outcome = { testId: test.id, result };
    outcomes.push(outcome);
    onResult?.(outcome);
  }

  return outcomes;
}

export function isPass(result: SandboxResult): boolean {
  return result.ok && result.passed === true;
}
