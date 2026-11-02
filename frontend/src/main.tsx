import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/tones.css';
import './styles/marks.css';
import './styles/base.css';
import './styles/shell.css';
import { App } from './app/App';
import { installChunkRecovery } from './lib/chunk-recovery';
import plexSansLatin from './styles/fonts/plex-sans-latin.woff2?url';

// C198: the Latin text face starts loading with the app code, not when the first text is laid out.
const preload = document.createElement('link');
preload.rel = 'preload';
preload.as = 'font';
preload.type = 'font/woff2';
preload.crossOrigin = 'anonymous';
preload.href = plexSansLatin;
document.head.appendChild(preload);

// A stale bundle after a deploy reloads the page once instead of showing an error.
installChunkRecovery();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
