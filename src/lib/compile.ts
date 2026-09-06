import * as ts from 'typescript';
import type { RawSourceMap } from '../types';

export interface CompileResult {
  js: string;
  map: RawSourceMap | null;
  /** Syntax-level problems. Type errors come from Monaco instead, see diagnostics.ts */
  errors: string[];
}

/**
 * Transpile one method. `preamble` is prepended so shared types and helpers are
 * in scope; the caller tracks how many lines that added so positions can be
 * shifted back to the method's own numbering.
 */
export function compile(code: string, fileName = 'method.ts'): CompileResult {
  const output = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      isolatedModules: true,
      removeComments: false,
      sourceMap: true,
    },
  });

  const errors = (output.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (d.file && typeof d.start === 'number') {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        return `Line ${line + 1}:${character + 1} — ${message}`;
      }
      return message;
    });

  let map: RawSourceMap | null = null;
  if (output.sourceMapText) {
    try {
      map = JSON.parse(output.sourceMapText) as RawSourceMap;
    } catch {
      map = null;
    }
  }

  // The trailing sourceMappingURL comment is noise once the map is parsed out.
  const js = output.outputText.replace(/^\/\/# sourceMappingURL=.*$/m, '');

  return { js, map, errors };
}

/** Cheap, stable hash used to mark run-history entries stale after an edit. */
export function hashCode(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Strip comments and string bodies so scanning cannot trip over their contents.
 *
 * Every branch blanks characters in place rather than removing them: the result
 * must stay the same length as the input, so offsets found here still index
 * correctly into the original source.
 */
function stripNoise(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) => lead + ' '.repeat(match.length - lead.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (match) => `\`${' '.repeat(Math.max(0, match.length - 2))}\``);
}

const PATTERNS: RegExp[] = [
  /export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/,
  /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\(|<)/,
  /(?:^|\n)\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\(|<)/,
];

/** Best guess at which function the sandbox should call. Overridable in the UI. */
export function detectEntryName(code: string): string {
  const stripped = stripNoise(code);
  for (const pattern of PATTERNS) {
    const match = stripped.match(pattern);
    if (match) return match[1];
  }
  return '';
}

export interface ParamInfo {
  name: string;
  optional: boolean;
  rest: boolean;
}

/**
 * Read the entry function's parameter list. Uses balanced scanning rather than
 * a regex so nested generics, object types and function types survive.
 */
export function detectParams(code: string, entry: string): ParamInfo[] {
  if (!entry) return [];
  const source = stripNoise(code);
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const starts = [
    new RegExp(`function\\s*\\*?\\s*${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*)?`),
  ];

  for (const pattern of starts) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) continue;

    // Skip any generic parameter list, then find the opening paren.
    let index = match.index + match[0].length;
    index = skipGenerics(source, index);
    while (index < source.length && /\s/.test(source[index])) index++;
    if (source[index] !== '(') continue;

    const list = readBalanced(source, index, '(', ')');
    if (list === null) continue;
    return splitTopLevel(list).map(parseParam);
  }

  return [];
}

function skipGenerics(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index++;
  if (source[index] !== '<') return start;
  let depth = 0;
  while (index < source.length) {
    if (source[index] === '<') depth++;
    else if (source[index] === '>') {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return start;
}

/** Return the text between a balanced pair, given the index of the opener. */
function readBalanced(source: string, openIndex: number, open: string, close: string): string | null {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return null;
}

/** Split on commas that sit at the top level, ignoring nested brackets. */
export function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of list) {
    if ('([{<'.includes(char)) depth++;
    else if (')]}>'.includes(char)) depth--;

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseParam(text: string): ParamInfo {
  const rest = text.startsWith('...');
  const body = rest ? text.slice(3) : text;
  // Cut at the first top-level ':' or '=' to leave just the binding name.
  let depth = 0;
  let name = body;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if ('([{<'.includes(char)) depth++;
    else if (')]}>'.includes(char)) depth--;
    else if (depth === 0 && (char === ':' || char === '=')) {
      name = body.slice(0, index);
      break;
    }
  }
  name = name.trim();
  const optional = name.endsWith('?') || /^[^:=]*=/.test(body);
  return { name: name.replace(/\?$/, '').trim(), optional, rest };
}

/**
 * Module specifiers this method imports at run time, in source order.
 *
 * Whole-statement `import type` is excluded: TypeScript erases it, so requiring
 * it would be pointless, and a type-only cycle — which TypeScript permits — would
 * otherwise be reported as an import cycle. Inline `{ type A, b }` still counts,
 * because `b` is a real runtime binding.
 */
export function detectImports(code: string): string[] {
  const source = stripNoise(code);

  const typeOnly = new Set<string>();
  const typePattern = /\bimport\s+type\s+[\w$*{}\s,]+?\bfrom\s*["']([^"']+)["']/g;
  let typeMatch: RegExpExecArray | null;
  while ((typeMatch = typePattern.exec(source)) !== null) {
    typeOnly.add(typeMatch[1]);
  }

  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (!typeOnly.has(match[1]) && !specifiers.includes(match[1])) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Is the entry function declared `async`? Used to pick the right Vitest form. */
export function isAsyncEntry(code: string, entry: string): boolean {
  if (!entry) return false;
  const source = stripNoise(code);
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`async\\s+function\\s*\\*?\\s*${escaped}\\b`).test(source) ||
    new RegExp(`\\b${escaped}\\s*(?::[^=\\n]+)?=\\s*async\\b`).test(source)
  );
}
