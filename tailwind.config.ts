import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#10B981',
          dark: '#059669',
        },
        header: '#1A1A1A',
        background: '#F8FAFC',
        foreground: '#111827',
        border: '#E5E7EB',
        'input-bg': '#F9FAFB',
        'input-focus': '#ECFDF5',
        'focus-ring': 'rgba(16, 185, 129, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'card-appear': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pulse-record': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.7)' },
          '50%': { boxShadow: '0 0 0 12px rgba(239, 68, 68, 0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        'scale-in': 'scale-in 0.28s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'card-appear': 'card-appear 0.25s ease-out',
        'pulse-record': 'pulse-record 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
