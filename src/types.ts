export type Matcher = 'equals' | 'throws' | 'truthy' | 'any';

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
  /** Last args used in the Run panel, kept so a session survives a reload */
  lastArgsExpr: string;
  tests: TestCase[];
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  version: 1;
  methods: MethodDoc[];
  selectedId: string | null;
}

/** A worker-side rendering of a runtime value (real values are not structured-cloneable). */
export interface ValuePreview {
  display: string;
  type: string;
}

export interface SandboxError {
  name: string;
  message: string;
  stack?: string;
}

export interface LogLine {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export interface Expectation {
  matcher: Matcher;
  expectedExpr: string;
}

export interface SandboxRequest {
  js: string;
  entryName: string;
  argsExpr: string;
  expectation?: Expectation;
}

export interface SandboxResult {
  ok: boolean;
  /** Which stage produced the outcome — useful for pointing at the real problem. */
  phase: 'args' | 'entry' | 'call' | 'expect' | 'timeout' | 'compile';
  value?: ValuePreview;
  thrown?: ValuePreview;
  expected?: ValuePreview;
  passed?: boolean;
  logs: LogLine[];
  durationMs: number;
  error?: SandboxError;
}
