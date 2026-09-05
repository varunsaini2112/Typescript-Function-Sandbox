import type { MethodDoc, RunHistoryEntry, TestCase, Workspace } from '../types';

const KEY = 'ts-sandbox:workspace:v1';

/** Runs kept per method. Bounded because history shares the localStorage quota. */
export const HISTORY_LIMIT = 10;

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
    lastArgs: [],
    argsMode: 'fields',
    tags: [],
    tests: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export const DEFAULT_PREAMBLE = `// Types and helpers here are in scope for every method.
// They are prepended at compile time and shared across the workspace.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
`;

const SEED_METHODS: MethodDoc[] = [
  newMethod({
    name: 'slugify',
    description: 'Turn an arbitrary title into a URL-safe slug.',
    tags: ['strings'],
    code: `export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
`,
    lastArgsExpr: '["  Hello, TypeScript World!  "]',
    lastArgs: ['"  Hello, TypeScript World!  "'],
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
    tags: ['arrays'],
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
    lastArgs: ['[1, 2, 3, 4, 5]', '2'],
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
    name: 'titleCase',
    description: 'Imports slugify — demonstrates one method building on another.',
    tags: ['strings'],
    code: `import { slugify } from "./slugify";

export function titleCase(title: string): string {
  return slugify(title)
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
`,
    lastArgsExpr: '["hello, typescript world!"]',
    lastArgs: ['"hello, typescript world!"'],
    tests: [
      newTest({
        name: 'capitalises each word',
        argsExpr: '["hello, typescript world!"]',
        expectedExpr: '"Hello Typescript World"',
      }),
    ],
  }),
  newMethod({
    name: 'retryWithBackoff',
    description: 'Async example — retries a flaky task, doubling the delay each attempt.',
    tags: ['async'],
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
  return {
    version: 2,
    methods: SEED_METHODS,
    selectedId: SEED_METHODS[0].id,
    preamble: DEFAULT_PREAMBLE,
    theme: 'system',
    blockRunOnTypeError: false,
    history: {},
  };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedWorkspace();

    const parsed = JSON.parse(raw) as Partial<Workspace>;
    if (!parsed || !Array.isArray(parsed.methods)) return seedWorkspace();

    // v1 workspaces have no preamble, theme, tags or history; defaults fill in.
    return {
      version: 2,
      methods: parsed.methods.map(normalize),
      selectedId: parsed.selectedId ?? null,
      preamble: parsed.preamble ?? DEFAULT_PREAMBLE,
      theme: parsed.theme ?? 'system',
      blockRunOnTypeError: parsed.blockRunOnTypeError ?? false,
      history: parsed.history ?? {},
    };
  } catch {
    return seedWorkspace();
  }
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export function saveWorkspace(workspace: Workspace): SaveResult {
  try {
    localStorage.setItem(KEY, JSON.stringify(workspace));
    return { ok: true };
  } catch (err) {
    const name = (err as Error)?.name ?? '';
    const message =
      name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
        ? 'Storage is full — recent changes are not being saved. Export a backup, then clear run history.'
        : 'Could not save to browser storage — changes will be lost on reload.';
    return { ok: false, message };
  }
}

function normalize(method: Partial<MethodDoc>): MethodDoc {
  return {
    ...newMethod(),
    ...method,
    id: method.id ?? uid(),
    tags: method.tags ?? [],
    lastArgs: method.lastArgs ?? [],
    argsMode: method.argsMode ?? 'fields',
    tests: (method.tests ?? []).map((test) => ({ ...newTest(), ...test })),
  } as MethodDoc;
}

/** Keep history bounded so it cannot quietly consume the storage quota. */
export function pushHistory(
  history: Record<string, RunHistoryEntry[]>,
  methodId: string,
  entry: RunHistoryEntry,
): Record<string, RunHistoryEntry[]> {
  const trimmed: RunHistoryEntry = {
    ...entry,
    result: { ...entry.result, logs: entry.result.logs.slice(0, 20) },
  };
  return { ...history, [methodId]: [trimmed, ...(history[methodId] ?? [])].slice(0, HISTORY_LIMIT) };
}

export function exportJson(workspace: Workspace): string {
  return JSON.stringify(
    { version: 2, methods: workspace.methods, preamble: workspace.preamble },
    null,
    2,
  );
}

/** Parse an imported file. Throws with a readable message when the shape is wrong. */
export function importJson(text: string): { methods: MethodDoc[]; preamble?: string } {
  const parsed = JSON.parse(text) as { methods?: unknown; preamble?: string };
  const methods = Array.isArray(parsed) ? parsed : parsed.methods;
  if (!Array.isArray(methods)) {
    throw new Error('Expected a JSON object with a "methods" array.');
  }
  return {
    methods: methods.map((m) => normalize({ ...(m as Partial<MethodDoc>), id: uid() })),
    preamble: typeof parsed.preamble === 'string' ? parsed.preamble : undefined,
  };
}

/** Unique name, so imports and duplicates never collide on the import specifier. */
export function uniqueName(base: string, methods: MethodDoc[], ignoreId?: string): string {
  const taken = new Set(
    methods.filter((m) => m.id !== ignoreId).map((m) => m.name.trim().toLowerCase()),
  );
  if (!taken.has(base.trim().toLowerCase())) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
