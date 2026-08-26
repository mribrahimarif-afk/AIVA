import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0a0d",
          900: "#111116",
          850: "#16161d",
          800: "#1c1c25",
          700: "#26262f",
          600: "#33333f",
        },
        accent: {
          500: "#7c5cff",
          400: "#9580ff",
          600: "#6743f0",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
