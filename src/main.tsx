import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@/lib/apiConfig';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// Native App feel: Prevent long-press browser copy/select menu on UI elements, while keeping inputs interactive
if (typeof window !== 'undefined') {
  window.addEventListener(
    'contextmenu',
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"], .allow-select, .selectable-text')) {
        return;
      }
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener('selectstart', (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('input, textarea, [contenteditable="true"], .allow-select, .selectable-text')) {
      return;
    }
    e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

