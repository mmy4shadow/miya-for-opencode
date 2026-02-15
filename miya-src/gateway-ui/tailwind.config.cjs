/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        miya: {
          bg: '#0f172a',
          card: '#1e293b',
          primary: '#38bdf8',
          accent: '#f59e0b',
          danger: '#ef4444',
          text: '#f8fafc',
        },
      },
      boxShadow: {
        glow: '0 0 50px rgba(56, 189, 248, 0.22)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
