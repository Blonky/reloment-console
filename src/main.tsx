import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/fraunces/index.css';
import './theme.css';
import { App } from './App.tsx';
import DemoGate from './shell/DemoGate.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DemoGate>
        <App />
      </DemoGate>
    </BrowserRouter>
  </StrictMode>,
);
