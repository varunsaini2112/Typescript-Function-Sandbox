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

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
`;

const SEED_METHODS: MethodDoc[] = [
  newMethod({
    name: 'slugify',
    description: 'Turn an arbitrary title into a URL-safe slug.',
    tags: ['strings', 'text'],
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
    name: 'truncate',
    description: 'Shorten text to a maximum length, adding an ellipsis. Note the optional third parameter.',
    tags: ['strings', 'text'],
    code: `export function truncate(text: string, max: number, suffix = "…"): string {
  if (max <= 0) throw new Error("max must be greater than 0");
  if (text.length <= max) return text;

  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}
`,
    lastArgsExpr: '["the quick brown fox", 12]',
    lastArgs: ['"the quick brown fox"', '12'],
    tests: [
      newTest({ name: 'shortens long text', argsExpr: '["hello world", 8]', expectedExpr: '"hello w…"' }),
      newTest({ name: 'leaves short text alone', argsExpr: '["short", 10]', expectedExpr: '"short"' }),
      newTest({ name: 'honours a custom suffix', argsExpr: '["hello world", 8, "..."]', expectedExpr: '"hello..."' }),
      newTest({
        name: 'rejects a zero maximum',
        argsExpr: '["abc", 0]',
        matcher: 'throws',
        expectedExpr: 'max must be greater than 0',
      }),
    ],
  }),
  newMethod({
    name: 'titleCase',
    description: 'Imports slugify — one method building directly on another.',
    tags: ['strings', 'text', 'composed'],
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
    name: 'headline',
    description: 'Imports titleCase and truncate — a three-level chain down to slugify.',
    tags: ['strings', 'text', 'composed'],
    code: `import { titleCase } from "./titleCase";
import { truncate } from "./truncate";

export function headline(raw: string, max = 24): string {
  return truncate(titleCase(raw), max);
}
`,
    lastArgsExpr: '["the quick brown fox jumps over", 24]',
    lastArgs: ['"the quick brown fox jumps over"', '24'],
    tests: [
      newTest({
        name: 'title-cases then truncates',
        argsExpr: '["the quick brown fox jumps over", 24]',
        expectedExpr: '"The Quick Brown Fox Jum…"',
      }),
      newTest({
        name: 'leaves a short headline whole',
        argsExpr: '["hello world"]',
        expectedExpr: '"Hello World"',
      }),
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
    name: 'groupBy',
    description: 'Group items by a derived key. Returns an object, so failures show a keyed diff path.',
    tags: ['arrays', 'collections'],
    code: `export function groupBy<T, K extends string>(
  items: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;

  for (const item of items) {
    const group = key(item);
    (out[group] ??= []).push(item);
  }
  return out;
}
`,
    lastArgsExpr: '[[{ name: "ana", team: "red" }, { name: "bo", team: "blue" }], (p) => p.team]',
    lastArgs: ['[{ name: "ana", team: "red" }, { name: "bo", team: "blue" }]', '(p) => p.team'],
    tests: [
      newTest({
        name: 'buckets by the key function',
        argsExpr:
          '[[{ name: "ana", team: "red" }, { name: "bo", team: "blue" }, { name: "cy", team: "red" }], (p) => p.team]',
        expectedExpr:
          '{ red: [{ name: "ana", team: "red" }, { name: "cy", team: "red" }], blue: [{ name: "bo", team: "blue" }] }',
      }),
      newTest({ name: 'empty input gives an empty object', argsExpr: '[[], (x) => "k"]', expectedExpr: '{}' }),
    ],
  }),
  newMethod({
    name: 'parsePort',
    description: 'Uses Result, ok and err from the shared preamble.',
    tags: ['parsing', 'validation'],
    code: `export function parsePort(input: string): Result<number> {
  const value = Number(input);

  if (!Number.isInteger(value)) return err("not an integer");
  if (value < 1 || value > 65535) return err("out of range");

  return ok(value);
}
`,
    lastArgsExpr: '["8080"]',
    lastArgs: ['"8080"'],
    tests: [
      newTest({ name: 'accepts a valid port', argsExpr: '["8080"]', expectedExpr: '{ ok: true, value: 8080 }' }),
      newTest({
        name: 'rejects non-numeric input',
        argsExpr: '["http"]',
        expectedExpr: '{ ok: false, error: "not an integer" }',
      }),
      newTest({
        name: 'rejects an out-of-range port',
        argsExpr: '["70000"]',
        expectedExpr: '{ ok: false, error: "out of range" }',
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
    argsMode: 'raw',
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

/**
 * Fresh copies of the bundled examples, with new ids every call so they can be
 * added to a workspace that already has content without colliding.
 */
export function exampleMethods(): MethodDoc[] {
  const now = Date.now();
  return SEED_METHODS.map((method) => ({
    ...method,
    id: uid(),
    tests: method.tests.map((test) => ({ ...test, id: uid() })),
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * The bundled examples whose names are not already taken — so adding examples to
 * an existing library never duplicates or overwrites the user's own methods.
 */
export function missingExamples(methods: MethodDoc[]): MethodDoc[] {
  const taken = new Set(methods.map((m) => m.name.trim().toLowerCase()));
  return exampleMethods().filter((m) => !taken.has(m.name.trim().toLowerCase()));
}

export function seedWorkspace(): Workspace {
  const methods = exampleMethods();
  return {
    version: 2,
    methods,
    selectedId: methods[0].id,
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
