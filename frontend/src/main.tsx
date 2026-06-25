import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Без StrictMode: в dev он дважды вызывает эффекты → двойной /me-запрос. Для Слоя 0 не нужен.
createRoot(document.getElementById('root')!).render(<App />);
