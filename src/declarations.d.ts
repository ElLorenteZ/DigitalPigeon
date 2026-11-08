/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
// Vite's worker import: the module's default export constructs the bundled worker.
declare module '*?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
// The JSON language's settings. The package's types for this path cover only the side-effect import.
declare module 'monaco-editor/language/json/monaco.contribution.js' {
  export const jsonDefaults: {
    setDiagnosticsOptions(options: { validate: boolean }): void;
    setModeConfiguration(configuration: Record<string, boolean>): void;
  };
}
