import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    // Resolves the "@/*" alias declared in tsconfig.json.
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // Points at src/ssr-entry.ts, our SSR error wrapper.
      server: { entry: "ssr-entry" },
    }),
    // On Vercel, Nitro compiles the SSR handler into Vercel Functions.
    // Everywhere else the plain build + standalone-server.mjs path stays as-is.
    ...(process.env["VERCEL"] ? [nitro()] : []),
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
