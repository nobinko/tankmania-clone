import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true, // 5173が埋まってたら落ちる（勝手に5174へ逃げない）
  },
});
