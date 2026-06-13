/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        dark: '#000000',
        darker: '#0A1020',
        card: '#14213D',
        cardHover: '#1B2C4F',
        input: '#0B1326',
        rowAlt: '#101A30',
        borderCol: 'rgba(229,229,229,0.10)',
        primary: '#FCA311',
        primaryDim: 'rgba(252,163,17,0.15)',
        pink: '#FFD27A',
        cyan: '#E5E5E5',
        greenAccent: '#34D399',
        amberAccent: '#FCA311',
        redAccent: '#FF453A',
        textPri: '#FFFFFF',
        textSec: '#CBD2DE',
        textMut: '#7C8597',
        tiktok: '#FF004F',
        youtube: '#FF0000',
        instagram: '#E1306C',
        facebook: '#1877F2',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
