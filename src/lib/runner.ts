import SandboxWorker from './sandbox.worker?worker';
import { buildModuleGraph, BundleError } from './bundle';
import { detectEntryName } from './compile';
import type {
  Expectation,
  MethodDoc,
  SandboxInit,
  SandboxReply,
  SandboxResult,
  TestCase,
} from '../types';

export const DEFAULT_TIMEOUT_MS = 2000;

export function entryFor(method: MethodDoc): string {
  return method.entryName.trim() || detectEntryName(method.code);
}

function failure(
  phase: SandboxResult['phase'],
  name: string,
  message: string,
  durationMs = 0,
): SandboxResult {
  return { ok: false, phase, passed: false, logs: [], durationMs, error: { name, message } };
}

/**
 * One worker shared by every run in a batch. Compiling and parsing the module
 * graph happens once, and a fresh module instance is created per run so state
 * still cannot leak between test cases.
 *
 * A run that overruns its timeout kills the worker; the next run transparently
 * spawns a replacement, so a runaway case costs one worker rather than the batch.
 */
export class SandboxSession {
  private worker: Worker | null = null;
  private counter = 0;

  constructor(private readonly init: SandboxInit) {}

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new SandboxWorker();
      this.worker.postMessage(this.init);
    }
    return this.worker;
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  run(
    argsExpr: string,
    expectation: Expectation | undefined,
    timeoutMs: number,
  ): Promise<SandboxResult> {
    const worker = this.ensureWorker();
    const runId = `r${++this.counter}`;

    return new Promise((resolve) => {
      let settled = false;

      const done = (result: SandboxResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(result);
      };

      const timer = setTimeout(() => {
        this.kill();
        done(
          failure(
            'timeout',
            'Timeout',
            `Execution exceeded ${timeoutMs}ms and was aborted. Check for an infinite loop.`,
            timeoutMs,
          ),
        );
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent<SandboxReply>) => {
        if (event.data.runId !== runId) return;
        done(event.data.result);
      };

      worker.onerror = (event) => {
        this.kill();
        done(failure('call', 'WorkerError', event.message || 'The sandbox worker crashed.'));
      };

      worker.postMessage({ type: 'run', runId, argsExpr, expectation });
    });
  }

  dispose(): void {
    this.kill();
  }
}

/** Compile the graph and open a session, or explain why that was not possible. */
function openSession(
  method: MethodDoc,
  methods: MethodDoc[],
  preamble: string,
): { session: SandboxSession } | { error: SandboxResult } {
  try {
    const modules = buildModuleGraph(method, methods, preamble);
    const init: SandboxInit = {
      type: 'init',
      modules,
      entryModule: method.name,
      entryName: entryFor(method),
    };
    return { session: new SandboxSession(init) };
  } catch (err) {
    if (err instanceof BundleError) {
      return { error: failure(err.kind, err.name, err.message) };
    }
    return { error: failure('compile', 'CompileError', (err as Error).message) };
  }
}

export async function runMethod(
  method: MethodDoc,
  methods: MethodDoc[],
  preamble: string,
  argsExpr: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SandboxResult> {
  const opened = openSession(method, methods, preamble);
  if ('error' in opened) return opened.error;

  try {
    return await opened.session.run(argsExpr, undefined, timeoutMs);
  } finally {
    opened.session.dispose();
  }
}

export interface TestOutcome {
  testId: string;
  result: SandboxResult;
}

export async function runTests(
  method: MethodDoc,
  methods: MethodDoc[],
  preamble: string,
  tests: TestCase[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onResult?: (outcome: TestOutcome) => void,
): Promise<TestOutcome[]> {
  const opened = openSession(method, methods, preamble);
  const outcomes: TestOutcome[] = [];

  for (const test of tests) {
    const result =
      'error' in opened
        ? opened.error
        : await opened.session.run(
            test.argsExpr,
            { matcher: test.matcher, expectedExpr: test.expectedExpr },
            timeoutMs,
          );
    const outcome = { testId: test.id, result };
    outcomes.push(outcome);
    onResult?.(outcome);
  }

  if (!('error' in opened)) opened.session.dispose();
  return outcomes;
}

export function isPass(result: SandboxResult): boolean {
  return result.ok && result.passed === true;
}
