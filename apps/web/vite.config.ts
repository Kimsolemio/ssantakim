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
        background_color: "#F3F2EE",
        theme_color: "#F3F2EE",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // 안드로이드: 유튜브·인스타·블로그에서 "공유" → 이 앱을 고르면 /share 로 열린다
        share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
      },
      workbox: {
        // 글꼴 조각(수백 개)은 미리 다 받지 않고, 쓴 것만 처음 받을 때 저장해 둔다
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: "/index.html",
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.endsWith(".woff2"),
          handler: "CacheFirst",
          options: { cacheName: "fonts", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 } },
        }],
      },
    }),
  ],
  server: { port: 5173 },
});
