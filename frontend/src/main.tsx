import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/tones.css';
import './styles/marks.css';
import './styles/base.css';
import './styles/shell.css';
import { App } from './app/App';
import { installChunkRecovery } from './lib/chunk-recovery';

// A stale bundle after a deploy reloads the page once instead of showing an error.
installChunkRecovery();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
