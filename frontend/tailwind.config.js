/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#15110a',          // тёплая тёмная база
        surface: '#1c1810',     // карточки
        surface2: '#1f1a10',    // плитки/поля
        accent: '#F5A623',      // янтарь
        accentInk: '#412402',   // текст на янтарной кнопке
        accentDim: '#2a2008',   // янтарная плитка-фон (заработок)
        muted: '#9a8f7d',       // приглушённый текст
        faint: '#6f665a',       // совсем тусклый
        okfill: '#1a2410',      // фон зелёной плашки обеда
        okline: '#97C459',      // зелёный акцент обеда
      },
    },
  },
  plugins: [],
};
