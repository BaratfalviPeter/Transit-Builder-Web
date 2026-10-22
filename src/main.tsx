import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ModelViewer } from './dev/ModelViewer';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* `?model=…` opens the stand-alone model viewer instead of the game. */}
    {new URLSearchParams(window.location.search).has('model') ? <ModelViewer /> : <App />}
  </StrictMode>,
);
