import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BuilderWorkspace } from './builder/BuilderWorkspace';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuilderWorkspace />
  </StrictMode>,
);
