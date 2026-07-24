import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/panel"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist/devtool"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/panel/index.html"),
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
