/** Value formatting and comparison. Pure — safe to import from a worker. */

export function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t !== 'object') return t;
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  return tag === 'Object' ? 'object' : tag.toLowerCase();
}

/** Readable, JS-flavoured rendering of a value. Cycles and depth are guarded. */
export function format(value: unknown, depth = 0, seen = new Set<object>()): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string') return depth === 0 ? JSON.stringify(value) : JSON.stringify(value);
  if (t === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'boolean') return String(value);
  if (t === 'symbol') return String(value);
  if (t === 'function') {
    const fn = value as (...a: unknown[]) => unknown;
    return `[Function: ${fn.name || 'anonymous'}]`;
  }

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (depth > 6) return '…';
  seen.add(obj);

  try {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    }
    if (value instanceof RegExp) return String(value);
    if (value instanceof Map) {
      const entries = [...value.entries()].map(
        ([k, v]) => `${format(k, depth + 1, seen)} => ${format(v, depth + 1, seen)}`,
      );
      return `Map(${value.size}) {${entries.length ? ' ' + entries.join(', ') + ' ' : ''}}`;
    }
    if (value instanceof Set) {
      const items = [...value.values()].map((v) => format(v, depth + 1, seen));
      return `Set(${value.size}) {${items.length ? ' ' + items.join(', ') + ' ' : ''}}`;
    }
    if (Array.isArray(value)) {
      const items = value.map((v) => format(v, depth + 1, seen));
      const oneLine = `[${items.join(', ')}]`;
      if (oneLine.length <= 72 || depth > 0) return oneLine;
      const pad = '  '.repeat(depth + 1);
      return `[\n${items.map((i) => pad + i).join(',\n')}\n${'  '.repeat(depth)}]`;
    }
    if (ArrayBuffer.isView(value)) {
      const arr = value as unknown as ArrayLike<number>;
      return `${(value as object).constructor.name}(${arr.length}) [${Array.from(arr).join(', ')}]`;
    }

    const ctor = (obj as { constructor?: { name?: string } }).constructor;
    const prefix = ctor && ctor.name && ctor.name !== 'Object' ? `${ctor.name} ` : '';
    const entries = Object.entries(obj).map(
      ([k, v]) => `${isPlainKey(k) ? k : JSON.stringify(k)}: ${format(v, depth + 1, seen)}`,
    );
    if (!entries.length) return `${prefix}{}`;
    const oneLine = `${prefix}{ ${entries.join(', ')} }`;
    if (oneLine.length <= 72 || depth > 0) return oneLine;
    const pad = '  '.repeat(depth + 1);
    return `${prefix}{\n${entries.map((e) => pad + e).join(',\n')}\n${'  '.repeat(depth)}}`;
  } finally {
    seen.delete(obj);
  }
}

function isPlainKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

/** Structural equality: NaN equals NaN, -0 differs from 0, Dates/Maps/Sets compared by content. */
export function deepEqual(a: unknown, b: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  const known = seen.get(a as object);
  if (known) return known === b;
  seen.set(a as object, b as object);

  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  if (a instanceof Date) return (a as Date).getTime() === (b as Date).getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Error) {
    return a.name === (b as Error).name && a.message === (b as Error).message;
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    return a.every((v, i) => deepEqual(v, bb[i], seen));
  }
  if (a instanceof Map) {
    const bb = b as Map<unknown, unknown>;
    if (a.size !== bb.size) return false;
    for (const [k, v] of a) {
      if (!bb.has(k) || !deepEqual(v, bb.get(k), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    const bb = b as Set<unknown>;
    if (a.size !== bb.size) return false;
    for (const v of a) if (!bb.has(v)) return false;
    return true;
  }

  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen),
  );
}
