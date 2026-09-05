/// <reference lib="webworker" />
import { deepEqual, firstDifference, format, typeOf } from './inspect';
import { decode, originalPositionFor, rebase, type DecodedMap, type Segment } from './sourcemap';
import type {
  LogLine,
  SandboxError,
  SandboxInit,
  SandboxMessage,
  SandboxReply,
  SandboxResult,
  SandboxRun,
  SourceLocation,
  ValuePreview,
} from '../types';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface SourceMeta {
  name: string;
  preambleLines: number;
}

interface Session {
  instantiate: () => (id: string) => Record<string, unknown>;
  entryModule: string;
  entryName: string;
  map: DecodedMap;
  meta: SourceMeta[];
  /** reportedLine - lineOffset === line within the generated bundle */
  lineOffset: number;
  /** First bundle line that belongs to a module rather than the harness. */
  firstModuleLine: number;
}

let session: Session | null = null;
let initError: SandboxError | null = null;

// ---- building the bundle ----------------------------------------------------

function buildSession(init: SandboxInit): Session {
  const lines: string[] = [
    '"use strict";',
    'var __registry = Object.create(null);',
    'function __norm(id) {',
    '  return String(id).replace(/^\\.{1,2}\\//, "").replace(/\\.(ts|js|tsx|jsx|mts|cts)$/, "").trim().toLowerCase();',
    '}',
    'function __frameLine(stack) {',
    '  var rows = String(stack || "").split("\\n");',
    '  for (var i = 0; i < rows.length; i++) {',
    '    var m = rows[i].match(/(\\d+):(\\d+)\\)?\\s*$/);',
    '    if (m) return parseInt(m[1], 10);',
    '  }',
    '  return 0;',
    '}',
    'function __instantiate() {',
    '  var cache = Object.create(null);',
    '  function require(id) {',
    '    var key = __norm(id);',
    '    var factory = __registry[key];',
    '    if (!factory) throw new Error("Cannot find module \'" + id + "\'");',
    '    if (!cache[key]) {',
    '      var module = { exports: {} };',
    '      cache[key] = module;',
    '      factory(module, module.exports, require);',
    '    }',
    '    return cache[key].exports;',
    '  }',
    '  return require;',
    '}',
  ];

  // The probe records what line number the engine reports for a line we know,
  // which removes any guesswork about how `new Function` offsets its body.
  const probeSourceLine = lines.length + 1;
  lines.push(
    'var __probe = (function () { try { throw new Error(); } catch (e) { return __frameLine(e.stack); } })();',
  );

  const segments: Segment[] = [];
  const sources: string[] = [];
  const meta: SourceMeta[] = [];
  let firstModuleLine = 0;

  for (const module of init.modules) {
    lines.push(
      `__registry[${JSON.stringify(module.name.toLowerCase())}] = function (module, exports, require) {`,
    );

    const startLine = lines.length + 1; // 1-based line of the module's first JS line
    if (!firstModuleLine) firstModuleLine = startLine;

    for (const line of module.js.split('\n')) lines.push(line);

    // Reach non-exported declarations without disturbing the mapped lines above.
    if (module.name === init.entryModule && IDENT.test(init.entryName)) {
      lines.push(
        `;try { Object.defineProperty(module.exports, "__sandboxLocal", { value: (typeof ${init.entryName} !== "undefined" ? ${init.entryName} : undefined), enumerable: false, configurable: true }); } catch (e) {}`,
      );
    }
    lines.push('};');

    if (module.map) {
      const sourceOffset = sources.length;
      sources.push(...module.map.sources);
      for (const source of module.map.sources) {
        meta.push({ name: module.name, preambleLines: module.preambleLines });
        void source;
      }
      segments.push(...rebase(decode(module.map), startLine - 1, sourceOffset));
    }
  }

  lines.push('return { instantiate: __instantiate, probe: __probe };');

  const factory = new Function(lines.join('\n')) as () => {
    instantiate: Session['instantiate'];
    probe: number;
  };
  const { instantiate, probe } = factory();

  return {
    instantiate,
    entryModule: init.entryModule,
    entryName: init.entryName,
    map: { sources, segments },
    meta,
    lineOffset: probe - probeSourceLine,
    firstModuleLine,
  };
}

// ---- position mapping -------------------------------------------------------

function mapPosition(active: Session, reportedLine: number, reportedColumn: number): SourceLocation | null {
  const bundleLine = reportedLine - active.lineOffset;
  if (bundleLine < active.firstModuleLine) return null;

  const found = originalPositionFor(active.map, bundleLine, reportedColumn);
  if (!found) return null;

  const index = active.map.sources.indexOf(found.source);
  const info = index >= 0 ? active.meta[index] : undefined;
  if (!info) return found;

  // Positions include the shared preamble; shift them back to the method's own
  // numbering, or attribute the frame to the preamble when it lands there.
  if (found.line <= info.preambleLines) {
    return { source: 'preamble', line: found.line, column: found.column };
  }
  return { source: info.name, line: found.line - info.preambleLines, column: found.column };
}

function mapStack(active: Session, stack: string | undefined): {
  stack?: string;
  location?: SourceLocation;
} {
  if (!stack) return {};

  const out: string[] = [];
  let location: SourceLocation | undefined;
  let sawMapped = false;

  for (const line of stack.split('\n')) {
    const match = line.match(/(\d+):(\d+)(\)?)\s*$/);
    if (!match || match.index === undefined) {
      out.push(line);
      continue;
    }

    const mapped = mapPosition(active, Number(match[1]), Number(match[2]));
    if (!mapped) {
      // Once real frames have been seen, the rest is sandbox plumbing.
      if (sawMapped) break;
      continue;
    }

    sawMapped = true;
    location ??= mapped;
    const head = line
      .slice(0, match.index)
      // Chrome wraps eval'd frames in "eval at fn (url:1:1), " — pure noise here.
      .replace(/eval at [^(]*\([^)]*\),\s*/, '')
      .replace('<anonymous>', `${mapped.source}.ts`);
    out.push(`${head}${mapped.line}:${mapped.column}${match[3]}`);
  }

  return { stack: out.join('\n'), location };
}

// ---- helpers ----------------------------------------------------------------

function preview(value: unknown): ValuePreview {
  return { display: format(value), type: typeOf(value) };
}

function describeError(err: unknown, active: Session | null): SandboxError {
  if (err instanceof Error) {
    const mapped = active ? mapStack(active, err.stack) : {};
    return { name: err.name, message: err.message, stack: mapped.stack ?? err.stack, location: mapped.location };
  }
  return { name: 'Thrown', message: format(err) };
}

function evalExpression(expr: string): unknown {
  return new Function(`"use strict"; return (${expr});`)();
}

function firstCallable(exportsObj: Record<string, unknown>): unknown {
  for (const key of Object.keys(exportsObj)) {
    if (typeof exportsObj[key] === 'function') return exportsObj[key];
  }
  return undefined;
}

// ---- running ----------------------------------------------------------------

async function execute(request: SandboxRun): Promise<SandboxResult> {
  const logs: LogLine[] = [];
  const started = performance.now();

  const original = { ...console };
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...args: unknown[]) => {
      if (logs.length < 500) {
        logs.push({ level, text: args.map((a) => (typeof a === 'string' ? a : format(a))).join(' ') });
      }
    };
  }

  const finish = (result: Omit<SandboxResult, 'logs' | 'durationMs'>): SandboxResult => {
    Object.assign(console, original);
    return {
      ...result,
      logs,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
  };

  if (initError || !session) {
    return finish({ ok: false, phase: 'compile', passed: false, error: initError ?? undefined });
  }
  const active = session;

  // ---- instantiate a fresh module graph, then resolve the entry function ----
  let entry: unknown;
  try {
    const exports = active.instantiate()(active.entryModule);
    const named = IDENT.test(active.entryName) ? active.entryName : '';
    const local = (exports as { __sandboxLocal?: unknown }).__sandboxLocal;

    entry =
      (named && typeof exports[named] === 'function' ? exports[named] : undefined) ??
      (typeof local === 'function' ? local : undefined) ??
      (typeof exports.default === 'function' ? exports.default : undefined) ??
      firstCallable(exports);

    if (typeof entry !== 'function') {
      return finish({
        ok: false,
        phase: 'entry',
        passed: false,
        error: {
          name: 'NoEntryFunction',
          message: named
            ? `No function named "${named}" was found. Export it, or clear the entry override to auto-detect.`
            : 'No callable function found. Declare or export a function in the editor.',
        },
      });
    }
  } catch (err) {
    return finish({ ok: false, phase: 'entry', passed: false, error: describeError(err, active) });
  }

  // ---- evaluate the arguments ----------------------------------------------
  let args: unknown[];
  try {
    const raw = request.argsExpr.trim() === '' ? [] : evalExpression(request.argsExpr);
    if (!Array.isArray(raw)) {
      return finish({
        ok: false,
        phase: 'args',
        passed: false,
        error: {
          name: 'BadArguments',
          message: `Arguments must be an array, e.g. [1, "two"]. Got ${typeOf(raw)}.`,
        },
      });
    }
    args = raw;
  } catch (err) {
    return finish({ ok: false, phase: 'args', passed: false, error: describeError(err, null) });
  }

  // ---- call it --------------------------------------------------------------
  let value: unknown;
  let thrown: unknown;
  let didThrow = false;
  try {
    value = await (entry as (...a: unknown[]) => unknown)(...args);
  } catch (err) {
    didThrow = true;
    thrown = err;
  }

  const { expectation } = request;

  if (!expectation) {
    return didThrow
      ? finish({ ok: false, phase: 'call', thrown: preview(thrown), error: describeError(thrown, active) })
      : finish({ ok: true, phase: 'call', value: preview(value) });
  }

  // ---- compare against the expectation --------------------------------------
  const { matcher, expectedExpr } = expectation;

  if (matcher === 'throws') {
    const needle = expectedExpr.trim();
    const message = didThrow ? (thrown instanceof Error ? thrown.message : format(thrown)) : '';
    return finish({
      ok: true,
      phase: 'expect',
      passed: didThrow && (needle === '' || message.includes(needle)),
      value: didThrow ? undefined : preview(value),
      thrown: didThrow ? preview(thrown) : undefined,
      expected: {
        display: needle ? `throws containing ${JSON.stringify(needle)}` : 'throws',
        type: 'expectation',
      },
    });
  }

  if (didThrow) {
    return finish({
      ok: false,
      phase: 'call',
      passed: false,
      thrown: preview(thrown),
      error: describeError(thrown, active),
    });
  }

  if (matcher === 'any') {
    return finish({ ok: true, phase: 'expect', passed: true, value: preview(value) });
  }

  if (matcher === 'truthy') {
    return finish({
      ok: true,
      phase: 'expect',
      passed: Boolean(value),
      value: preview(value),
      expected: { display: 'truthy', type: 'expectation' },
    });
  }

  try {
    const expected = expectedExpr.trim() === '' ? undefined : evalExpression(expectedExpr);
    const passed = deepEqual(value, expected);
    return finish({
      ok: true,
      phase: 'expect',
      passed,
      value: preview(value),
      expected: preview(expected),
      difference: passed ? undefined : (firstDifference(expected, value) ?? undefined),
    });
  } catch (err) {
    return finish({ ok: false, phase: 'expect', passed: false, error: describeError(err, null) });
  }
}

// ---- message loop -----------------------------------------------------------

self.onmessage = async (event: MessageEvent<SandboxMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    initError = null;
    session = null;
    try {
      session = buildSession(message);
    } catch (err) {
      initError =
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { name: 'InitError', message: String(err) };
    }
    return;
  }

  const result = await execute(message);
  const reply: SandboxReply = { runId: message.runId, result };
  self.postMessage(reply);
};
