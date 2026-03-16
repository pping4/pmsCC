import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'IBM Plex Sans Thai', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: { DEFAULT: '#1e40af', light: '#3b82f6', dark: '#1e3a8a' },
      },
    },
  },
  plugins: [],
};
export default config;
