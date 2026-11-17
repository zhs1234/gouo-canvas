import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/streamdown/dist/*.js'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        gray: colors.zinc,
        // blue-* 即全站主色（首页同系的暖橙），深浅两套色值见 index.css 的 --c-blue-*
        blue: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [shade, `rgb(var(--c-blue-${shade}) / <alpha-value>)`])),
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
        },
      },
      // 只加深文字用的 gray-400/500（边框、背景不受影响），浅色米色底上也达到 4.5:1；色值见 index.css 的 --c-text-gray-*
      textColor: {
        gray: {
          400: 'rgb(var(--c-text-gray-400) / <alpha-value>)',
          500: 'rgb(var(--c-text-gray-500) / <alpha-value>)',
        },
        // 橙色文字单独加深/提亮，不改背景色阶，避免白字按钮和深色图标互相打架
        blue: {
          400: 'rgb(var(--c-blue-text-400) / <alpha-value>)',
          500: 'rgb(var(--c-blue-text-500) / <alpha-value>)',
          600: 'rgb(var(--c-blue-text-600) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui-sans)'],
        mono: ['var(--font-mono)'],
      },
      // 正文行高按中文阅读拉开；text-xs 保持 12px，作为界面文字下限
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.45' }],
        sm: ['0.875rem', { lineHeight: '1.55' }],
        base: ['1rem', { lineHeight: '1.6' }],
        lg: ['1.125rem', { lineHeight: '1.5' }],
        xl: ['1.25rem', { lineHeight: '1.4' }],
        '2xl': ['1.5rem', { lineHeight: '1.3' }],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-lg)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
    },
  },
  plugins: [],
}
