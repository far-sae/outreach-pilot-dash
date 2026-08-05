/**
 * Background send worker.
 *
 * Drains the send queue continuously so a large campaign does not depend on a
 * browser tab staying open. Run it with `npm run worker`, and keep it running
 * as a service in production.
 *
 * It shares `drainQueue` with the in-app "process queue" button, so rotation,
 * daily caps, warmup, and suppression behave identically either way.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY: a worker has no user session, so it cannot
 * satisfy the row level security policies that gate normal access. Keep that
 * key server-side only — never give it a VITE_ prefix.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { drainQueue } from "@/server/send-engine";

// Read .env directly rather than depending on a loader or a Node flag.
function loadEnv(file = ".env") {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      const key = m[1] as string;
      let value = (m[2] ?? "").trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env; rely on the real environment */
  }
}

loadEnv();

const url = process.env["VITE_SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const appUrl = (process.env["APP_URL"] ?? "http://localhost:5173").replace(/\/+$/, "");
const intervalMs = Number(process.env["WORKER_INTERVAL_MS"] ?? 15_000);
const batchSize = Number(process.env["WORKER_BATCH"] ?? 50);

if (!url) {
  console.error("VITE_SUPABASE_URL is not set. Add it to .env.");
  process.exit(1);
}
if (!serviceKey) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "Find it in Supabase → Project settings → API keys → service_role.\n" +
      "Add it to .env WITHOUT a VITE_ prefix so it never reaches the browser.",
  );
  process.exit(1);
}
if (appUrl.includes("localhost")) {
  console.warn(
    "WARNING: APP_URL is localhost, so tracking and unsubscribe links in sent\n" +
      "         mail will not resolve for recipients. Set APP_URL before real sends.",
  );
}

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

let running = true;
let cycles = 0;

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n[${stamp()}] ${sig} received — finishing current batch, then stopping.`);
    running = false;
  });
}

async function tick() {
  // Recover rows a previous run claimed but never completed.
  if (cycles % 20 === 0) {
    const { data: recovered } = await client.rpc("requeue_stale_all", {
      p_older_than_minutes: 15,
    });
    if (typeof recovered === "number" && recovered > 0) {
      console.log(`[${stamp()}] requeued ${recovered} stale item(s)`);
    }
  }

  const { data: users, error } = await client.rpc("users_with_queued");
  if (error) throw new Error(error.message);

  const list = (users ?? []) as { user_id: string }[];
  if (list.length === 0) return;

  for (const { user_id } of list) {
    if (!running) break;
    const result = await drainQueue(client, user_id, {
      max: batchSize,
      appUrl,
      useServiceRole: true,
    });

    if (result.blocked) {
      console.log(`[${stamp()}] ${user_id.slice(0, 8)}… blocked: ${result.blocked}`);
    } else if (result.claimed > 0) {
      console.log(
        `[${stamp()}] ${user_id.slice(0, 8)}… sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}`,
      );
    }
  }
}

console.log(
  `[${stamp()}] send worker started — polling every ${Math.round(intervalMs / 1000)}s, ` +
    `up to ${batchSize} messages per user per cycle.`,
);

while (running) {
  try {
    await tick();
  } catch (err) {
    // Never exit on a transient error; the queue outlives any single failure.
    console.error(`[${stamp()}] cycle failed:`, err instanceof Error ? err.message : err);
  }
  cycles += 1;
  if (running) await sleep(intervalMs);
}

console.log(`[${stamp()}] worker stopped.`);
