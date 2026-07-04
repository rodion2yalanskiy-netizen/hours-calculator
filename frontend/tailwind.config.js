/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Фоны
        bg: '#070F0C',          // основной фон
        'bg-2': '#0D1613',      // фон карточек
        'bg-3': '#152220',      // подложки, инпуты
        // Акцент
        accent: '#34D399',      // основной emerald
        'accent-2': '#059669',  // hover/active emerald
        'accent-dim': '#065F46',// фон бейджей
        // Текст
        text: '#F0FDF4',        // основной
        'text-2': '#A7F3D0',    // приглушённый на emerald-подложке
        'text-3': '#6EE7B7',    // подписи, метки
        'text-muted': '#94A3B8',// серый нейтральный
        // Границы
        border: '#1F2937',
        'border-2': '#374151',
        // Статусы
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
    },
  },
  plugins: [],
};
