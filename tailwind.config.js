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
        dark: '#0A0B0F',
        darker: '#12141A',
        card: '#1A1D26',
        cardHover: '#1E2230',
        input: '#0F111A',
        rowAlt: '#151820',
        borderCol: 'rgba(255,255,255,0.07)',
        primary: '#6C63FF',
        primaryDim: 'rgba(108,99,255,0.15)',
        pink: '#FF6584',
        cyan: '#00D9F5',
        greenAccent: '#34D399',
        amberAccent: '#FF9F0A',
        redAccent: '#FF453A',
        textPri: '#F0F2FF',
        textSec: '#8892B0',
        textMut: '#4A5568',
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
