import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          foreground: '#FFFFFF',
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
        },
        success: { light: '#D1FAE5', DEFAULT: '#059669', dark: '#047857' },
        warning: { light: '#FEF3C7', DEFAULT: '#D97706', dark: '#B45309' },
        danger:  { light: '#FEE2E2', DEFAULT: '#DC2626', dark: '#B91C1C' },
        event: {
          meeting:   '#3B82F6',
          personal:  '#8B5CF6',
          reminder:  '#F59E0B',
          taskblock: '#10B981',
          google:    '#94A3B8',
        },
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'xs':   ['11px', { lineHeight: '16px' }],
        'sm':   ['13px', { lineHeight: '20px' }],
        'base': ['14px', { lineHeight: '22px' }],
        'md':   ['15px', { lineHeight: '24px' }],
        'lg':   ['17px', { lineHeight: '26px' }],
        'xl':   ['20px', { lineHeight: '28px' }],
        '2xl':  ['24px', { lineHeight: '32px' }],
        '3xl':  ['30px', { lineHeight: '36px' }],
      },
      borderRadius: {
        'xs':    '4px',
        'sm':    '6px',
        DEFAULT: '8px',
        'md':    '8px',
        'lg':    '10px',
        'xl':    '12px',
        '2xl':   '16px',
      },
      boxShadow: {
        'xs':      '0 1px 2px rgba(0,0,0,0.05)',
        'sm':      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        DEFAULT:   '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)',
        'md':      '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)',
        'lg':      '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)',
        'xl':      '0 20px 25px -5px rgba(0,0,0,0.10), 0 10px 10px -5px rgba(0,0,0,0.04)',
        'primary': '0 0 0 3px rgba(79,70,229,0.15)',
        'danger':  '0 0 0 3px rgba(220,38,38,0.15)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
