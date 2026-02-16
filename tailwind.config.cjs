/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f14",
        slate: "#111827",
        steel: "#1f2937",
        mist: "#e5e7eb",
        mint: "#34d399",
        cyan: "#22d3ee"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["IBM Plex Sans", "ui-sans-serif", "system-ui"]
      }
    }
  },
  plugins: []
};
