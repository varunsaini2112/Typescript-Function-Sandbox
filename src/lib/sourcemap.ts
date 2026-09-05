/**
 * Minimal source-map reader: enough to turn a position in generated JS back
 * into a position in the TypeScript the user actually wrote. Pure — safe to
 * import from a worker.
 */
import type { RawSourceMap, SourceLocation } from '../types';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const CHAR_TO_INT = new Map<string, number>();
for (let i = 0; i < B64.length; i++) CHAR_TO_INT.set(B64[i], i);

/** Decode one variable-length quantity, returning the value and the next index. */
function decodeVlq(input: string, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let index = start;

  for (;;) {
    const digit = CHAR_TO_INT.get(input[index++]);
    if (digit === undefined) throw new Error('Invalid source map VLQ');
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }

  // The low bit is the sign, the rest is the magnitude.
  const negative = (result & 1) === 1;
  result >>>= 1;
  return [negative ? -result : result, index];
}

export interface Segment {
  genLine: number;
  genCol: number;
  sourceIndex: number;
  srcLine: number;
  srcCol: number;
}

export interface DecodedMap {
  sources: string[];
  /** Sorted by genLine then genCol. */
  segments: Segment[];
}

/** All positions here are 0-based, matching the source map spec. */
export function decode(map: RawSourceMap): DecodedMap {
  const segments: Segment[] = [];
  let sourceIndex = 0;
  let srcLine = 0;
  let srcCol = 0;

  const lines = map.mappings.split(';');
  for (let genLine = 0; genLine < lines.length; genLine++) {
    let genCol = 0;
    const line = lines[genLine];
    if (!line) continue;

    for (const field of line.split(',')) {
      if (!field) continue;
      let index = 0;
      let value: number;

      [value, index] = decodeVlq(field, index);
      genCol += value;

      // A one-field segment carries no original position; skip it.
      if (index >= field.length) continue;

      [value, index] = decodeVlq(field, index);
      sourceIndex += value;
      [value, index] = decodeVlq(field, index);
      srcLine += value;
      [value, index] = decodeVlq(field, index);
      srcCol += value;

      segments.push({ genLine, genCol, sourceIndex, srcLine, srcCol });
    }
  }

  return { sources: map.sources.slice(), segments };
}

/**
 * Shift a decoded map so its generated positions sit at `lineOffset` inside a
 * larger bundle, and renumber its sources into a shared list.
 */
export function rebase(map: DecodedMap, lineOffset: number, sourceOffset: number): Segment[] {
  return map.segments.map((segment) => ({
    ...segment,
    genLine: segment.genLine + lineOffset,
    sourceIndex: segment.sourceIndex + sourceOffset,
  }));
}

/**
 * Find the original position for a generated one. Both inputs are 1-based
 * (the form stack traces use); the returned location is 1-based too.
 */
export function originalPositionFor(
  map: DecodedMap,
  genLine: number,
  genCol: number,
): SourceLocation | null {
  const targetLine = genLine - 1;
  const targetCol = genCol - 1;

  let best: Segment | null = null;
  for (const segment of map.segments) {
    if (segment.genLine !== targetLine) continue;
    if (segment.genCol > targetCol) break;
    best = segment;
  }

  // Nothing on that line at or before the column — fall back to its first segment.
  if (!best) {
    best = map.segments.find((segment) => segment.genLine === targetLine) ?? null;
  }
  if (!best) return null;

  return {
    source: map.sources[best.sourceIndex] ?? '?',
    line: best.srcLine + 1,
    column: best.srcCol + 1,
  };
}
