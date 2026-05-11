import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001"
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true
      }
    }
  },
  test: {
    environment: "jsdom"
  }
});
