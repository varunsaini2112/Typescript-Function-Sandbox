import * as ts from 'typescript';

export interface CompileResult {
  js: string;
  /** Syntax-level problems. Type errors surface as squiggles in the editor instead. */
  errors: string[];
}

export function compile(code: string): CompileResult {
  const output = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      isolatedModules: true,
      removeComments: false,
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

  return { js: output.outputText, errors };
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
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const pattern of PATTERNS) {
    const match = stripped.match(pattern);
    if (match) return match[1];
  }
  return '';
}

/** Parameter names of the entry function, used to label argument inputs. */
export function detectParams(code: string, entry: string): string[] {
  if (!entry) return [];
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`function\\s*\\*?\\s*${escaped}\\s*(?:<[^>]*>)?\\s*\\(([^)]*)\\)`),
    new RegExp(`${escaped}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\s*\\*?\\s*)?(?:<[^>]*>)?\\s*\\(([^)]*)\\)`),
  ];
  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match) {
      return match[1]
        .split(',')
        .map((p) => p.split(':')[0].split('=')[0].trim())
        .filter(Boolean);
    }
  }
  return [];
}
