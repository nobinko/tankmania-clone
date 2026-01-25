import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // Socket.IO (default path is /socket.io/)
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
