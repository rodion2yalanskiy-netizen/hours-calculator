/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070F0C',       // фон Axiom:Void
        accent: '#34D399',   // акцент
      },
    },
  },
  plugins: [],
};
