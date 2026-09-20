/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0B0F19',
          surface: '#111827',
          card: '#1F2937',
          border: '#374151',
          primary: '#3B82F6',
          accent: '#10B981',
          danger: '#EF4444',
          warning: '#F59E0B'
        }
      }
    },
  },
  plugins: [],
}
