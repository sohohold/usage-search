import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto-sans)', '"Noto Sans JP"', 'system-ui', 'sans-serif'],
        serif: ['var(--font-noto-serif)', '"Noto Serif JP"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
