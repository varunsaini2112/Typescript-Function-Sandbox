import React from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import App from './App';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

// Serve Monaco from the local bundle rather than a CDN so the sandbox works offline.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker();
  },
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  allowNonTsExtensions: true,
  strict: true,
  noEmit: true,
  lib: ['es2020', 'dom'],
});

monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  // 1108: 'return' outside a function — snippets are allowed to be loose.
  // 2307 is deliberately NOT ignored: every method is registered as a model, so
  // a cross-method import that fails to resolve is a genuine error worth seeing,
  // and reporting it plainly beats the implicit-any cascade it used to cause.
  diagnosticCodesToIgnore: [1108],
});

loader.config({ monaco });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
