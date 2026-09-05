import { detectImports, isAsyncEntry, splitTopLevel } from './compile';
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

/** The method itself as a standalone source file, description kept as JSDoc. */
export function generateSourceFile(method: MethodDoc): string {
  const description = method.description.trim();
  const header = description ? `/**\n * ${description.split('\n').join('\n * ')}\n */\n` : '';
  return header + method.code;
}
