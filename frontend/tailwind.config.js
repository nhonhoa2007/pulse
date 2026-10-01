/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#000000',
        paper: '#fafafa',
        mist: '#efefef',
        cloud: '#d5d5d5',
        ash: '#969696',
        graphite: '#424242',
        meta: '#385898',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        badge: '1000px',
        avatar: '1000px',
        button: '1000px',
        pill: '1000px',
        linkcard: '8px',
        postcard: '0px',
        feedcolumn: '18px',
      },
      boxShadow: {
        feed: '0 0 12px rgba(0, 0, 0, 0.04), 0 0 0 48px #fafafa',
        subtle: '0 0 12px rgba(0, 0, 0, 0.04)',
      },
      maxWidth: {
        feed: '640px',
      },
    },
  },
  plugins: [],
};
