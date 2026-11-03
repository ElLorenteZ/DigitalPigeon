/**
 * Renderer entry. Runs in a sandboxed, context-isolated process with no Node.js
 * access. HTTP calls and storage belong to the main process (see
 * context/foundation/tech-stack.md); the renderer reaches them only through the
 * API that preload.ts exposes.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const App = () => (
  <main>
    <h1>DigitalPigeon</h1>
  </main>
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
