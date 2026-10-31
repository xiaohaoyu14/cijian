import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { exclude: ["ts-fsrs"] },
  plugins: [{ name: "development-cloud-loopback", apply: "serve",
    transformIndexHtml: html => html.replace("connect-src 'self' https:", "connect-src 'self' https: ws: http://127.0.0.1:* http://localhost:*") }],
});
