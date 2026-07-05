import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { registerServiceWorker, isPushSupportedInBrowser } from './lib/push';
import './index.css';

// Регистрируем Service Worker для push (permission НЕ запрашиваем — только через Настройки).
if (isPushSupportedInBrowser()) { registerServiceWorker(); }

// Без StrictMode: в dev он дважды вызывает эффекты (двойной /auth/me на старте).
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
);
