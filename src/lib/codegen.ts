import { detectEntryName, detectImports, isAsyncEntry, splitTopLevel } from './compile';
import { normalizeSpecifier } from './bundle';
import { entryFor } from './runner';
import type { MethodDoc, TestCase } from '../types';

export type Framework = 'vitest' | 'jest';

function indentBlock(text: string, indent: string): string {
  const lines = text.trim().split('\n');
  return lines.length === 1 ? lines[0] : lines.map((line, i) => (i === 0 ? line : indent + line)).join('\n');
}

/**
 * Turn the stored args array expression into a call argument list. Unwrapping
 * the outer brackets keeps the generated call properly typed — spreading an
 * array literal instead would not satisfy a fixed parameter list.
 */
function callArgs(test: TestCase): string {
  const trimmed = test.argsExpr.trim();
  if (trimmed === '' || trimmed === '[]') return '';

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const parts = splitTopLevel(inner).map((part) => indentBlock(part, '      '));
    return parts.join(', ');
  }

  // Not a literal array (a variable, a call) — spread it and let the user adjust.
  return `...${indentBlock(trimmed, '      ')}`;
}

function assertion(test: TestCase, entry: string, isAsync: boolean): string {
  const args = callArgs(test);
  const call = `${entry}(${args})`;

  switch (test.matcher) {
    case 'throws': {
      const message = test.expectedExpr.trim();
      const matcher = message ? `toThrow(${JSON.stringify(message)})` : 'toThrow()';
      return isAsync
        ? `await expect(${call}).rejects.${matcher};`
        : `expect(() => ${call}).${matcher};`;
    }
    case 'truthy':
      return isAsync
        ? `await expect(${call}).resolves.toBeTruthy();`
        : `expect(${call}).toBeTruthy();`;
    case 'any':
      return isAsync
        ? `await expect(${call}).resolves.not.toThrow();`
        : `expect(() => ${call}).not.toThrow();`;
    case 'equals':
    default: {
      const expected = indentBlock(test.expectedExpr.trim() || 'undefined', '    ');
      return isAsync
        ? `await expect(${call}).resolves.toEqual(${expected});`
        : `expect(${call}).toEqual(${expected});`;
    }
  }
}

/**
 * Emit a runnable test file. Argument and expected values are stored as source
 * text already, so they transfer verbatim rather than being reconstructed.
 */
export function generateTestFile(
  method: MethodDoc,
  methods: MethodDoc[],
  framework: Framework = 'vitest',
): string {
  const entry = entryFor(method) || method.name;
  const isAsync = isAsyncEntry(method.code, entry);
  const enabled = method.tests.filter((test) => test.enabled);

  const header =
    framework === 'vitest'
      ? `import { describe, expect, it } from "vitest";`
      : `import { describe, expect, it } from "@jest/globals";`;

  // Anything this method imports will need importing in the test file too.
  const dependencies = detectImports(method.code)
    .map((specifier) => methods.find((m) => m.name.toLowerCase() === normalizeSpecifier(specifier).toLowerCase()))
    .filter((m): m is MethodDoc => Boolean(m));

  const notes = dependencies.length
    ? `\n// Depends on: ${dependencies.map((d) => d.name).join(', ')} — export those alongside this file.\n`
    : '';

  const cases = enabled.length
    ? enabled
        .map((test) => {
          const name = test.name.trim() || 'works';
          const body = assertion(test, entry, isAsync);
          return `  it(${JSON.stringify(name)}, ${isAsync ? 'async ' : ''}() => {\n    ${body}\n  });`;
        })
        .join('\n\n')
    : `  it.todo("add a case");`;

  const skipped = method.tests.length - enabled.length;
  const skippedNote = skipped ? `\n// ${skipped} disabled case${skipped === 1 ? '' : 's'} not exported.\n` : '';

  return `${header}
import { ${entry} } from "./${method.name}";
${notes}${skippedNote}
describe(${JSON.stringify(method.name)}, () => {
${cases}
});
`;
}

// ---- single-method .ts files ------------------------------------------------

const SANDBOX_OPEN = '/* @sandbox — ts-sandbox metadata; delete this block and the file still compiles';

/** Everything about a method except its code, which is the file body itself. */
interface MethodFileMeta {
  name: string;
  description: string;
  entryName: string;
  tags: string[];
  lastArgsExpr: string;
  lastArgs: string[];
  argsMode: MethodDoc['argsMode'];
  tests: TestCase[];
  /** Lines of generated JSDoc above the code, so import can strip exactly those. */
  headerLines: number;
}

/**
 * The method as a standalone `.ts` file: the description becomes JSDoc, and a
 * trailing comment carries the test cases and settings. `tsc` ignores the
 * comment, so the file drops straight into a repo, but importing it back here
 * restores the method whole.
 */
export function generateSourceFile(method: MethodDoc): string {
  const description = method.description.trim();
  const header = description
    ? `/**\n${description.split('\n').map((line) => ` * ${line}`).join('\n')}\n */\n`
    : '';
  const headerLines = header ? header.split('\n').length - 1 : 0;

  const meta: MethodFileMeta = {
    name: method.name,
    description: method.description,
    entryName: method.entryName,
    tags: method.tags,
    lastArgsExpr: method.lastArgsExpr,
    lastArgs: method.lastArgs,
    argsMode: method.argsMode,
    tests: method.tests,
    headerLines,
  };

  // `*/` inside test code would close the comment early. `\/` is a valid JSON
  // string escape, so JSON.parse restores it with no unescaping step of our own.
  const json = JSON.stringify(meta, null, 2).replace(/\*\//g, '*\\/');

  return `${header}${method.code.trimEnd()}\n\n${SANDBOX_OPEN}\n${json}\n*/\n`;
}

const META_BLOCK = /\/\*\s*@sandbox\b[^\n]*\n([\s\S]*?)\n\*\/\s*$/;
const LEADING_JSDOC = /^\s*\/\*\*([\s\S]*?)\*\/\n?/;

/**
 * Read a `.ts` file back into a method. Files written by `generateSourceFile`
 * come back whole; any other TypeScript file still imports, with the name and
 * description inferred and the rest left for the user to fill in.
 */
export function parseSourceFile(text: string, fallbackName: string): Partial<MethodDoc> {
  const match = text.match(META_BLOCK);

  if (match) {
    try {
      const meta = JSON.parse(match[1]) as Partial<MethodFileMeta>;
      const body = text.slice(0, match.index).trimEnd();
      const code = body.split('\n').slice(meta.headerLines ?? 0).join('\n');

      return {
        name: meta.name || fallbackName,
        description: meta.description ?? '',
        entryName: meta.entryName ?? '',
        tags: meta.tags ?? [],
        lastArgsExpr: meta.lastArgsExpr ?? '[]',
        lastArgs: meta.lastArgs ?? [],
        argsMode: meta.argsMode ?? 'fields',
        tests: meta.tests ?? [],
        code: `${code}\n`,
      };
    } catch {
      // Metadata is corrupt — fall through and treat it as a plain source file.
    }
  }

  // A plain TypeScript file: infer what we can, leave the rest empty.
  let code = text;
  let description = '';
  const doc = text.match(LEADING_JSDOC);

  // Only lift a prose comment into the description. One carrying @param/@returns
  // is real API documentation and belongs in the code. JSDoc lines start with an
  // asterisk, which has to be skipped before looking for the tag.
  if (doc && !/^[ \t]*\*?[ \t]*@\w+/m.test(doc[1])) {
    description = doc[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
      .join('\n')
      .trim();
    code = text.slice(doc[0].length);
  }

  return {
    name: detectEntryName(code) || fallbackName,
    description,
    code: code.trimEnd() + '\n',
  };
}
