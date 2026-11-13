import { fileURLToPath } from 'node:url';

export default {
  plugins: {
    // Explicit path: the build runs from the repo root, not from frontend/.
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
};
