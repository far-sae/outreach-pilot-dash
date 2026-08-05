import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    // Resolves the "@/*" alias declared in tsconfig.json.
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Points at src/ssr-entry.ts, our SSR error wrapper.
      server: { entry: "ssr-entry" },
    }),
    // Must come after tanstackStart.
    viteReact(),
  ],
  resolve: {
    // Keep a single copy of React when linked packages are present.
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    // Native modules that must stay external — bundling them breaks the
    // TCP/TLS sockets SMTP and IMAP depend on.
    external: ["nodemailer", "imapflow"],
  },
});
