import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        // Librerías grandes en archivos separados: el navegador las guarda en
        // caché y no las vuelve a descargar cuando cambia el código de la app.
        manualChunks(id) {
          // Helper compartido de CommonJS: va con React para que la pantalla
          // inicial no tenga que descargar el archivo de gráficos.
          if (id.includes("commonjsHelpers")) return "react";
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "react";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("leaflet")) return "maps";
          if (/@radix-ui|[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id)) return "ui";
        },
      },
    },
  },
}));
