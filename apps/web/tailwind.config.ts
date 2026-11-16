import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}", "./shared/**/*.{ts,tsx}", "./core/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
