import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
        serif: ['"Noto Serif JP"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
