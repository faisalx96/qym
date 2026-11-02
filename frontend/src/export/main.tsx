/** Entry of the exported run page file (C173). Built by vite.export.config.ts into one HTML file. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/tones.css';
import '../styles/marks.css';
import '../styles/base.css';
import '../styles/shell.css';
import { ExportApp } from './ExportApp';
import { readSnapshot } from './snapshot';

// The file has no server: every request fails at once, so a part the snapshot lacks shows its error state.
window.fetch = () => Promise.reject(new TypeError('This is an exported file: it does not load data.'));

const root = createRoot(document.getElementById('root')!);
const snapshot = readSnapshot(document);
root.render(
  <StrictMode>
    {snapshot ? (
      <ExportApp snapshot={snapshot} />
    ) : (
      <p>This export page holds no run. Export the run again from qym.</p>
    )}
  </StrictMode>,
);
