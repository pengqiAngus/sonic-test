import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./store/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#10202d",
        mist: "#eef4ef",
        line: "#d8e2da",
        accent: "#0f766e",
        raise: "#ca8a04",
        bid: "#047857",
        ask: "#b45309"
      },
      boxShadow: {
        panel: "0 20px 60px rgba(16, 32, 45, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
