import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>
);
