import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api';
import { SessionProvider } from './session';
import { UiProvider } from './ui';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <UiProvider>
          {(dark) => (
            <div className={`relative mx-auto min-h-dvh max-w-[440px] bg-background shadow-[0_0_80px_#172b4d0d] ${dark ? 'dark' : ''}`}>
              <App />
            </div>
          )}
        </UiProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
