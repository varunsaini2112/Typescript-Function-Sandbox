import type { MethodDoc, TestCase, Workspace } from '../types';

const KEY = 'ts-sandbox:workspace:v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newTest(partial: Partial<TestCase> = {}): TestCase {
  return {
    id: uid(),
    name: 'new case',
    argsExpr: '[]',
    matcher: 'equals',
    expectedExpr: 'undefined',
    enabled: true,
    ...partial,
  };
}

export function newMethod(partial: Partial<MethodDoc> = {}): MethodDoc {
  const now = Date.now();
  return {
    id: uid(),
    name: 'untitled',
    description: '',
    code: `export function untitled(input: string): string {\n  return input;\n}\n`,
    entryName: '',
    lastArgsExpr: '[]',
    tests: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

const SEED_METHODS: MethodDoc[] = [
  newMethod({
    name: 'slugify',
    description: 'Turn an arbitrary title into a URL-safe slug.',
    code: `export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
`,
    lastArgsExpr: '["  Hello, TypeScript World!  "]',
    tests: [
      newTest({
        name: 'lowercases and joins words',
        argsExpr: '["Hello, TypeScript World!"]',
        expectedExpr: '"hello-typescript-world"',
      }),
      newTest({ name: 'trims stray separators', argsExpr: '["  --Edge case--  "]', expectedExpr: '"edge-case"' }),
      newTest({ name: 'empty string stays empty', argsExpr: '[""]', expectedExpr: '""' }),
    ],
  }),
  newMethod({
    name: 'chunk',
    description: 'Split an array into fixed-size chunks. Throws on a non-positive size.',
    code: `export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("size must be greater than 0");

  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
`,
    lastArgsExpr: '[[1, 2, 3, 4, 5], 2]',
    tests: [
      newTest({
        name: 'splits with a ragged tail',
        argsExpr: '[[1, 2, 3, 4, 5], 2]',
        expectedExpr: '[[1, 2], [3, 4], [5]]',
      }),
      newTest({ name: 'empty input', argsExpr: '[[], 3]', expectedExpr: '[]' }),
      newTest({
        name: 'rejects size 0',
        argsExpr: '[[1, 2], 0]',
        matcher: 'throws',
        expectedExpr: 'size must be greater than 0',
      }),
    ],
  }),
  newMethod({
    name: 'retryWithBackoff',
    description: 'Async example — retries a flaky task, doubling the delay each attempt.',
    code: `type Task<T> = () => Promise<T>;

export async function retryWithBackoff<T>(
  task: Task<T>,
  attempts = 3,
  baseDelayMs = 1,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      console.log(\`attempt \${attempt + 1} failed\`);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }

  throw lastError;
}
`,
    lastArgsExpr: `[
  (() => {
    let n = 0;
    return async () => {
      if (++n < 3) throw new Error("flaky");
      return "ok after " + n;
    };
  })()
]`,
    tests: [
      newTest({
        name: 'succeeds on the third attempt',
        argsExpr: `[
  (() => {
    let n = 0;
    return async () => {
      if (++n < 3) throw new Error("flaky");
      return "ok after " + n;
    };
  })()
]`,
        expectedExpr: '"ok after 3"',
      }),
      newTest({
        name: 'gives up and rethrows',
        argsExpr: '[async () => { throw new Error("always down"); }, 2]',
        matcher: 'throws',
        expectedExpr: 'always down',
      }),
    ],
  }),
];

export function seedWorkspace(): Workspace {
  return { version: 1, methods: SEED_METHODS, selectedId: SEED_METHODS[0].id };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedWorkspace();
    const parsed = JSON.parse(raw) as Workspace;
    if (!parsed || !Array.isArray(parsed.methods)) return seedWorkspace();
    return { version: 1, methods: parsed.methods.map(normalize), selectedId: parsed.selectedId ?? null };
  } catch {
    return seedWorkspace();
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(workspace));
  } catch {
    // Storage full or blocked — the session still works, it just will not persist.
  }
}

function normalize(method: Partial<MethodDoc>): MethodDoc {
  return {
    ...newMethod(),
    ...method,
    id: method.id ?? uid(),
    tests: (method.tests ?? []).map((test) => ({ ...newTest(), ...test })),
  } as MethodDoc;
}

export function exportJson(workspace: Workspace): string {
  return JSON.stringify({ version: 1, methods: workspace.methods }, null, 2);
}

/** Parse an imported file. Throws with a readable message when the shape is wrong. */
export function importJson(text: string): MethodDoc[] {
  const parsed = JSON.parse(text) as { methods?: unknown };
  const methods = Array.isArray(parsed) ? parsed : parsed.methods;
  if (!Array.isArray(methods)) {
    throw new Error('Expected a JSON object with a "methods" array.');
  }
  return methods.map((m) => normalize({ ...(m as Partial<MethodDoc>), id: uid() }));
}
