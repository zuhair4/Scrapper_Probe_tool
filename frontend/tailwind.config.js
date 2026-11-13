/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true, // resolve the globs from this file, not from the directory the build runs in
    files: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Open Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      colors: {
        dl: {
          green: '#86BC25',
          'green-dark': '#6a9a1c',
          'green-light': '#f0f7e6',
          'green-pale': '#f7fbef',
          black: '#000000',
          charcoal: '#282728',
          neon: '#86EB22',
          blue: '#00A3E0',
        },
      },
    },
  },
  plugins: [],
};
