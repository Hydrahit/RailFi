import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Reads CSS variables injected by Next.js font loader in layout.tsx
        display: ["var(--font-syne)",  "ui-sans-serif", "sans-serif"],
        sans:    ["var(--font-syne)",  "ui-sans-serif", "sans-serif"],
        mono:    ["var(--font-mono)",  "ui-monospace",  "monospace"],
      },
      colors: {
        "rp-green":  "#14F195",
        "rp-purple": "#9945FF",
      },
      keyframes: {
        "gradient-flow": {
          "0%":   { backgroundPosition: "0% center"   },
          "100%": { backgroundPosition: "200% center" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 0px rgba(20,241,149,0)"    },
          "50%":      { boxShadow: "0 0 28px rgba(20,241,149,0.28)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)"    },
        },
        shimmer: {
          "0%":   { backgroundPosition: "200% 0"  },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1",   transform: "scale(1)"    },
          "50%":      { opacity: "0.5", transform: "scale(0.85)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to:   { transform: "rotate(360deg)" },
        },
      },
      animation: {
        gradient:    "gradient-flow 3s linear infinite",
        "glow-pulse":"glow-pulse 2.5s ease-in-out infinite",
        "fade-up":   "fade-up 0.35s ease both",
        shimmer:     "shimmer 1.6s infinite",
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
        "spin-slow": "spin-slow 0.8s linear infinite",
      },
      backgroundSize: {
        "200": "200% auto",
      },
    },
  },
  plugins: [],
};

export default config;
