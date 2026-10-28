/** @type {import('tailwindcss').Config} */
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './types.ts',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
        dark: '#0f172a',
        card: '#1e293b',
      },
    },
  },
  plugins: [animate],
};
