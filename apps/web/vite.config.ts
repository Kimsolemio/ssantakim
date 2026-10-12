import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon.svg"],
      manifest: {
        name: "우리집 요리",
        short_name: "요리",
        description: "가족 레시피·냉장고·장보기",
        lang: "ko",
        display: "standalone",
        start_url: "/",
        background_color: "#FFF8F0",
        theme_color: "#F97316",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // 안드로이드: 유튜브·인스타·블로그에서 "공유" → 이 앱을 고르면 /share 로 열린다
        share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: { port: 5173 },
});
