import * as monaco from 'monaco-editor';
import type { TypeDiagnostic } from '../types';

/**
 * Pull type errors out of Monaco's TypeScript worker.
 *
 * The editor already computes these for the red squiggles; surfacing them means
 * you learn about a type error without having to spot the underline. The run
 * path erases types without checking them, so this is the only real check there is.
 */
export async function getDiagnostics(uri: monaco.Uri): Promise<TypeDiagnostic[]> {
  const model = monaco.editor.getModel(uri);
  if (!model) return [];

  const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
  const client = await getWorker(uri);
  const key = uri.toString();

  const [semantic, syntactic] = await Promise.all([
    client.getSemanticDiagnostics(key),
    client.getSyntacticDiagnostics(key),
  ]);

  return [...syntactic, ...semantic]
    .map((diagnostic): TypeDiagnostic | null => {
      const message = flatten(diagnostic.messageText);
      const start = diagnostic.start ?? 0;
      const { lineNumber, column } = model.getPositionAt(start);
      return {
        message,
        line: lineNumber,
        column,
        code: diagnostic.code,
        // 1 is TypeScript's "error" category; anything else is advisory here.
        severity: diagnostic.category === 1 ? 'error' : 'warning',
      };
    })
    .filter((d): d is TypeDiagnostic => d !== null)
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

type MessageChain = { messageText: string; next?: MessageChain[] };

function flatten(message: string | MessageChain | undefined): string {
  if (message === undefined) return '';
  if (typeof message === 'string') return message;
  const nested = (message.next ?? []).map((entry) => flatten(entry)).join(' ');
  return nested ? `${message.messageText} ${nested}` : message.messageText;
}
