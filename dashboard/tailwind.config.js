/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0f0f0f',
        card: '#1a1a1a',
        border: '#2a2a2a',
        accent: '#f97316',
        'text-primary': '#e5e5e5',
        muted: '#6b7280',
      },
    },
  },
  plugins: [],
}
