import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    historyApiFallback: true,
    proxy: {
      // Proxy WebSocket connections to streaming server
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      // Proxy HLS streams to streaming server
      '/hls': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy status endpoint to streaming server
      '/status': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy deck-info endpoint to streaming server
      '/deck-info': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
