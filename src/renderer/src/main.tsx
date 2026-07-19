import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { installFlowDiagramExportBridge } from './lib/flowDiagramExportBridge';
import '@fontsource-variable/plus-jakarta-sans';
import './i18n';
import './styles/globals.css';

(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
  new URL('./excalidraw-assets/', window.location.href).href;

installFlowDiagramExportBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>
);
