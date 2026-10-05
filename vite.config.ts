import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages liegt unter https://<name>.github.io/<repo>/
// Die GitHub Action setzt BASE_PATH automatisch auf "/<repo>/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
