/**
 * UI entry. Runs in the browser with no Node.js access. HTTP calls and storage belong to the local server
 * (src/server/, ADR 0002); the UI reaches them only through the operations in src/renderer/api.ts.
 */
import './renderer/zod-jitless';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/app';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
