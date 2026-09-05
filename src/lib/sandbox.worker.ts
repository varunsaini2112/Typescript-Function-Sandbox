/// <reference lib="webworker" />
import { deepEqual, format, typeOf } from './inspect';
import type { LogLine, SandboxRequest, SandboxResult, ValuePreview } from '../types';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function preview(value: unknown): ValuePreview {
  return { display: format(value), type: typeOf(value) };
}

function describeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'Thrown', message: format(err) };
}

/** Evaluate a standalone JS expression (used for test arguments and expected values). */
function evalExpression(expr: string): unknown {
  return new Function(`"use strict"; return (${expr});`)();
}

function firstCallable(exportsObj: Record<string, unknown>): unknown {
  for (const key of Object.keys(exportsObj)) {
    if (typeof exportsObj[key] === 'function') return exportsObj[key];
  }
  return undefined;
}

self.onmessage = async (event: MessageEvent<SandboxRequest>) => {
  const { js, entryName, argsExpr, expectation } = event.data;
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

  const finish = (result: Omit<SandboxResult, 'logs' | 'durationMs'>) => {
    Object.assign(console, original);
    const payload: SandboxResult = {
      ...result,
      logs,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
    self.postMessage(payload);
  };

  // ---- resolve the entry function ------------------------------------------
  let entry: unknown;
  try {
    const named = IDENT.test(entryName) ? entryName : '';
    const source = `"use strict";
const module = { exports: {} };
const exports = module.exports;
${js}
;return { exports: module.exports, local: ${named ? `(typeof ${named} !== 'undefined' ? ${named} : undefined)` : 'undefined'} };`;

    const { exports, local } = new Function(source)() as {
      exports: Record<string, unknown>;
      local: unknown;
    };

    entry =
      (named && typeof exports[named] === 'function' ? exports[named] : undefined) ??
      (typeof local === 'function' ? local : undefined) ??
      (typeof exports.default === 'function' ? exports.default : undefined) ??
      firstCallable(exports);

    if (typeof entry !== 'function') {
      finish({
        ok: false,
        phase: 'entry',
        error: {
          name: 'NoEntryFunction',
          message: named
            ? `No function named "${named}" was found. Export it, or clear the entry override to auto-detect.`
            : 'No callable function found. Declare or export a function in the editor.',
        },
      });
      return;
    }
  } catch (err) {
    finish({ ok: false, phase: 'entry', error: describeError(err) });
    return;
  }

  // ---- evaluate the arguments ----------------------------------------------
  let args: unknown[];
  try {
    const raw = argsExpr.trim() === '' ? [] : evalExpression(argsExpr);
    if (!Array.isArray(raw)) {
      finish({
        ok: false,
        phase: 'args',
        error: {
          name: 'BadArguments',
          message: `Arguments must be an array, e.g. [1, "two"]. Got ${typeOf(raw)}.`,
        },
      });
      return;
    }
    args = raw;
  } catch (err) {
    finish({ ok: false, phase: 'args', error: describeError(err) });
    return;
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

  if (!expectation) {
    if (didThrow) {
      finish({ ok: false, phase: 'call', thrown: preview(thrown), error: describeError(thrown) });
    } else {
      finish({ ok: true, phase: 'call', value: preview(value) });
    }
    return;
  }

  // ---- compare against the expectation --------------------------------------
  const { matcher, expectedExpr } = expectation;

  if (matcher === 'throws') {
    const needle = expectedExpr.trim();
    const message = didThrow ? (thrown instanceof Error ? thrown.message : format(thrown)) : '';
    const passed = didThrow && (needle === '' || message.includes(needle));
    finish({
      ok: true,
      phase: 'expect',
      passed,
      value: didThrow ? undefined : preview(value),
      thrown: didThrow ? preview(thrown) : undefined,
      expected: { display: needle ? `throws containing ${JSON.stringify(needle)}` : 'throws', type: 'expectation' },
    });
    return;
  }

  if (didThrow) {
    finish({
      ok: false,
      phase: 'call',
      passed: false,
      thrown: preview(thrown),
      error: describeError(thrown),
    });
    return;
  }

  if (matcher === 'any') {
    finish({ ok: true, phase: 'expect', passed: true, value: preview(value) });
    return;
  }

  if (matcher === 'truthy') {
    finish({
      ok: true,
      phase: 'expect',
      passed: Boolean(value),
      value: preview(value),
      expected: { display: 'truthy', type: 'expectation' },
    });
    return;
  }

  try {
    const expected = expectedExpr.trim() === '' ? undefined : evalExpression(expectedExpr);
    finish({
      ok: true,
      phase: 'expect',
      passed: deepEqual(value, expected),
      value: preview(value),
      expected: preview(expected),
    });
  } catch (err) {
    finish({ ok: false, phase: 'expect', error: describeError(err) });
  }
};
