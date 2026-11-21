/** @type {import('tailwindcss').Config} */
// Tailwind is built into the game (no CDN), so it also works on a Wi-Fi with no internet.
export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx', './services/**/*.ts'],
  theme: { extend: {} },
  plugins: [],
};
