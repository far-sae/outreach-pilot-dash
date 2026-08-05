/**
 * Production server.
 *
 * `npm run build` emits a fetch handler (dist/server/ssr-entry.js) and static
 * assets (dist/client), but nothing that listens on a port. This wraps them in
 * a Node HTTP server so the app can be deployed to Railway, Fly, Render, a
 * Docker host, or a plain VPS without any platform-specific adapter.
 *
 * Run with:  node server.mjs      (PORT and HOST are read from the environment)
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = resolve(root, "dist/client");
const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = process.env["HOST"] ?? "0.0.0.0";

const { default: ssr } = await import("./dist/server/ssr-entry.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Resolves a URL path to a file inside dist/client, or null.
 * Returns null for anything that escapes the directory — without this check a
 * request for `/../../.env` would serve secrets.
 */
async function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // Malformed percent-encoding.
  }
  if (decoded.includes("\0")) return null;

  const candidate = resolve(join(CLIENT_DIR, decoded));
  if (candidate !== CLIENT_DIR && !candidate.startsWith(CLIENT_DIR + sep)) return null;

  try {
    const info = await stat(candidate);
    return info.isFile() ? { path: candidate, size: info.size, mtime: info.mtime } : null;
  } catch {
    return null;
  }
}

function toWebRequest(req) {
  const host = req.headers.host ?? `localhost:${PORT}`;
  // Trust the proxy's scheme header: Railway, Fly and friends terminate TLS,
  // so req is plain HTTP even when the client used https. Absolute URLs built
  // here end up in unsubscribe links, so getting the scheme wrong matters.
  const proto = (req.headers["x-forwarded-proto"] ?? "").toString().split(",")[0] || "http";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  });
}

async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  for (const [key, value] of webRes.headers) res.setHeader(key, value);
  if (!webRes.body) return res.end();
  Readable.fromWeb(webRes.body).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      if (req.method === "GET" || req.method === "HEAD") {
        const file = await resolveStatic(pathname);
        if (file) {
          const ext = extname(file.path).toLowerCase();
          res.statusCode = 200;
          res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
          res.setHeader("content-length", String(file.size));
          // Everything under /assets is content-hashed by Vite, so it can be
          // cached forever. Anything else might change under the same name.
          res.setHeader(
            "cache-control",
            pathname.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
          );
          if (req.method === "HEAD") return res.end();
          return createReadStream(file.path).pipe(res);
        }
      }

      const webRes = await ssr.fetch(toWebRequest(req), {}, {});
      await sendWebResponse(res, webRes);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end("Internal Server Error");
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log(`Outreach Console listening on http://${HOST}:${PORT}`);
  if (!process.env["APP_URL"]) {
    console.warn(
      "WARNING: APP_URL is not set. Unsubscribe links will be built from the\n" +
        "         request host, which is usually right behind a proxy but should\n" +
        "         be set explicitly to your public URL.",
    );
  }
});

// Let the platform stop us cleanly instead of killing in-flight sends.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  });
}
