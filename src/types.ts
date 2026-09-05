export type Matcher = 'equals' | 'throws' | 'truthy' | 'any';

export type ThemePref = 'light' | 'dark' | 'system';

export interface TestCase {
  id: string;
  name: string;
  /** JS expression that must evaluate to an array of arguments, e.g. `[1, 2]` */
  argsExpr: string;
  matcher: Matcher;
  /** JS expression for the expected value, or the expected error message substring for `throws` */
  expectedExpr: string;
  enabled: boolean;
}

export interface MethodDoc {
  id: string;
  name: string;
  description: string;
  code: string;
  /** Optional override for which function to invoke; auto-detected when empty */
  entryName: string;
  /** Combined argument array, always kept in sync and used by tests and history */
  lastArgsExpr: string;
  /** One expression per detected parameter, when editing arguments as fields */
  lastArgs: string[];
  argsMode: 'fields' | 'raw';
  tags: string[];
  tests: TestCase[];
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  version: 2;
  methods: MethodDoc[];
  selectedId: string | null;
  /** Types and helpers prepended to every method at compile time */
  preamble: string;
  theme: ThemePref;
  blockRunOnTypeError: boolean;
  /** Most recent runs per method id, newest first */
  history: Record<string, RunHistoryEntry[]>;
}

export interface RunHistoryEntry {
  id: string;
  argsExpr: string;
  timestamp: number;
  /** Hash of the code at run time, so stale entries can be marked */
  codeHash: string;
  result: SandboxResult;
}

/** A worker-side rendering of a runtime value (real values are not structured-cloneable). */
export interface ValuePreview {
  display: string;
  type: string;
}

/** A position in the user's own source, recovered through the source map. */
export interface SourceLocation {
  /** Method name, or "preamble" when the error is in shared code */
  source: string;
  line: number;
  column: number;
}

export interface SandboxError {
  name: string;
  message: string;
  stack?: string;
  location?: SourceLocation;
}

/** The first structural difference between an expected and an actual value. */
export interface Difference {
  /** Dotted/bracketed path from the root, empty at the root itself */
  path: string;
  expected: ValuePreview;
  actual: ValuePreview;
  /** Set when both sides are strings, for character-level highlighting */
  stringDiff?: { prefix: number; expectedMiddle: string; actualMiddle: string; suffix: number };
}

export interface LogLine {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export interface Expectation {
  matcher: Matcher;
  expectedExpr: string;
}

export interface SandboxResult {
  ok: boolean;
  /** Which stage produced the outcome — useful for pointing at the real problem. */
  phase: 'args' | 'entry' | 'call' | 'expect' | 'timeout' | 'compile' | 'resolve';
  value?: ValuePreview;
  thrown?: ValuePreview;
  expected?: ValuePreview;
  difference?: Difference;
  passed?: boolean;
  logs: LogLine[];
  durationMs: number;
  error?: SandboxError;
}

/** Type-checker feedback pulled out of Monaco, independent of the run path. */
export interface TypeDiagnostic {
  message: string;
  line: number;
  column: number;
  code: number;
  severity: 'error' | 'warning';
}

// ---- worker protocol --------------------------------------------------------

export interface RawSourceMap {
  version: number;
  sources: string[];
  mappings: string;
}

/** One compiled method in the module graph handed to the worker. */
export interface ModuleSource {
  name: string;
  js: string;
  map: RawSourceMap | null;
  /** Lines of shared preamble prepended before the method's own first line */
  preambleLines: number;
}

export interface SandboxInit {
  type: 'init';
  modules: ModuleSource[];
  entryModule: string;
  entryName: string;
}

export interface SandboxRun {
  type: 'run';
  runId: string;
  argsExpr: string;
  expectation?: Expectation;
}

export type SandboxMessage = SandboxInit | SandboxRun;

export interface SandboxReply {
  runId: string;
  result: SandboxResult;
}
