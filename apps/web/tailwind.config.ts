import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        border: "var(--border)",
        accent: "var(--accent)",
        muted: "var(--muted)"
      },
      fontFamily: {
        sans: ["var(--font-jakarta)"],
        display: ["var(--font-space)"]
      },
      boxShadow: {
        glow: "0 24px 120px rgba(27, 157, 255, 0.22)"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" }
        },
        shine: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" }
        }
      },
      animation: {
        float: "float 8s ease-in-out infinite",
        shine: "shine 3.2s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;

