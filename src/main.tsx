import React from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import App from './App';
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
  // 2307: unresolved module — cross-method imports resolve at run time, not here.
  diagnosticCodesToIgnore: [1108, 2307],
});

loader.config({ monaco });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
