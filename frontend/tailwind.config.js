/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // PKG-02: semantic tokens backed by CSS variables — 3 theme
        // (light / dark / black) chỉ đổi giá trị biến trong index.css.
        // Định dạng "R G B" + <alpha-value> giữ cho các modifier /50, /60 hoạt động.
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        paper: 'rgb(var(--c-canvas) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        mist: 'rgb(var(--c-mist) / <alpha-value>)',
        cloud: 'rgb(var(--c-cloud) / <alpha-value>)',
        ash: 'rgb(var(--c-ash) / <alpha-value>)',
        graphite: 'rgb(var(--c-graphite) / <alpha-value>)',
        meta: 'rgb(var(--c-meta) / <alpha-value>)',
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
        feed: '0 0 12px rgba(0, 0, 0, 0.06), 0 0 0 48px rgb(var(--c-canvas))',
        subtle: '0 0 12px rgba(0, 0, 0, 0.04)',
      },
      maxWidth: {
        feed: '640px',
      },
    },
  },
  plugins: [],
};
