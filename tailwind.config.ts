import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Satterwhite Law Firm brand palette
        'firm-navy': '#1a2744',
        'firm-gold': '#c9a84c',
        'firm-light': '#f8f7f4',
      },
      fontFamily: {
        'garamond': ['Garamond', 'EB Garamond', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
