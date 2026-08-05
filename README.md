# Outreach Console

Dashboard for a cold-email outreach tool aimed at solo founders. Prospects, groups,
templates, and campaigns are stored in Supabase, with email/password sign-in and
per-user row isolation.

## Stack

- [TanStack Start](https://tanstack.com/start) (SSR) + [TanStack Router](https://tanstack.com/router)
- React 19 + TypeScript
- Tailwind CSS v4
- [shadcn/ui](https://ui.shadcn.com) components on Radix primitives
- Recharts for the campaign chart
- [Supabase](https://supabase.com) for the database and auth
- Vite

## Getting started

Requires Node.js 20+.

**1. Install**

```sh
npm install
```

**2. Create a Supabase project**

At [supabase.com/dashboard](https://supabase.com/dashboard). Then open **SQL Editor →
New query** and run these two files in order:

1. [supabase/schema.sql](supabase/schema.sql) — the six core tables and their row
   level security policies
2. [supabase/migrations/002_email.sql](supabase/migrations/002_email.sql) — the
   `email_accounts` and `email_sends` tables used for sending
3. [supabase/migrations/003_tracking.sql](supabase/migrations/003_tracking.sql) —
   open tracking, unsubscribe, and reply detection
4. [supabase/migrations/004_sending_pool.sql](supabase/migrations/004_sending_pool.sql) —
   the mailbox pool, send queue, and suppression list

All four are idempotent, so re-running them is safe.

**3. Add your credentials**

Copy [.env.example](.env.example) to `.env` and fill in the two values from
**Project settings → API keys**:

```sh
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

**4. Run**

```sh
npm run dev
```

Create an account on the sign-in screen. The first sign-in seeds your database with
the sample prospects, groups, templates, and campaigns, so the dashboard has
something to show.

## Sending email

Mail goes out through a **pool of connected mailboxes**, rotating across them and
respecting each one's daily allowance. Add them under **Settings → Sending
mailboxes**, and use **Test** and **Send test** on each before it joins the rotation.

### Why a pool

Volume is limited by _reputation_, not by your provider's cap. Gmail and Microsoft
judge the sending address and domain, and a single address pushing hundreds of cold
emails a day lands in spam within about a week — taking your normal business mail
with it.

The working figure is roughly **40 messages/day per mailbox**. You scale by adding
mailboxes, not by raising one mailbox's limit:

| Target/day | Mailboxes needed |
| ---------- | ---------------- |
| 500        | ~13              |
| 5,000      | ~125             |
| 50,000     | ~1,250           |

New mailboxes **warm up** automatically — starting at 5/day and adding 3/day until
they reach their ceiling — because a fresh address at full volume is the fastest
route into spam folders.

### How a send runs

1. **Enqueue.** A campaign writes one `send_queue` row per recipient, skipping
   anyone unsubscribed or suppressed. Nothing is lost if you close the tab.
2. **Drain.** [src/server/send-engine.ts](src/server/send-engine.ts) claims work for
   one mailbox at a time via `claim_queue_items`, which uses `FOR UPDATE SKIP LOCKED`
   so two workers can never take the same row.
3. **Send.** Paced by each mailbox's delay, capped by its warmup-adjusted allowance.

The browser drains the queue while you watch, and `npm run worker` does the same
thing unattended for large runs. Both call the same engine, so rotation, caps,
warmup, and suppression can only be implemented once.

Failures are handled by class: a 4xx is retried with backoff, a 5xx is not, and only
a rejected _recipient_ (550/551/553) suppresses the address — a 535 means our own
credentials are wrong, and suppressing the recipient for that would blame the wrong
party. A mailbox that fails five times in a row pauses itself.

## Deploying

The app must be publicly reachable before you send to real prospects: unsubscribe
links are built from `APP_URL`, and a `localhost` link works for nobody but you.

```sh
npm run build    # emits dist/client (static) and dist/server (SSR handler)
npm start        # node server.mjs — serves both on PORT (default 3000)
```

[server.mjs](server.mjs) is a plain Node HTTP server wrapping the SSR fetch
handler and serving `dist/client`. There is no platform adapter, so the same
build runs on Railway, Fly, Render, Docker, or a bare VPS.

A [Dockerfile](Dockerfile) is included. Deploy it **twice** — once as the web
service (`node server.mjs`) and once as the worker (`npm run worker`). They share
an image and a database; only the command differs.

### Environment

| Variable                        | Where                | Notes                                      |
| ------------------------------- | -------------------- | ------------------------------------------ |
| `VITE_SUPABASE_URL`             | **build time**       | Inlined into the client bundle             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | **build time**       | Inlined into the client bundle             |
| `APP_URL`                       | runtime              | Public URL, e.g. `https://app.example.com` |
| `SUPABASE_SERVICE_ROLE_KEY`     | runtime, worker only | Bypasses RLS — never prefix `VITE_`        |

`VITE_*` values are baked in when the bundle is compiled, **not** read at runtime.
Setting them only on the running container produces a build that cannot reach
Supabase. The Dockerfile takes them as build args for this reason.

### The worker

```sh
npm run worker
```

Needs `SUPABASE_SERVICE_ROLE_KEY` in `.env` — it has no user session, so it cannot
satisfy the row level security policies that gate normal access. That key bypasses
RLS entirely: keep it server-side and never give it a `VITE_` prefix.

### Suppression

`suppressions` is the permanent do-not-contact list, fed by unsubscribes, hard
bounces at SMTP time, and bounce messages found over IMAP. It is checked at enqueue
_and_ again at send time, since a list built earlier can be stale.

### Opens, unsubscribes, and replies

Every message carries a random `track_token`. It is the only identifier that appears
in a public URL, so nothing about the user or prospect is exposed.

**Opens** — a 1×1 GIF at `/t/o/$token` ([src/routes/t/o/$token.ts](src/routes/t/o/$token.ts)).
Loading it marks the send opened. The image is always returned, even if the database
call fails, so a recipient never sees a broken image. Most clients block remote
images by default, so treat open rates as a floor, not a measurement.

**Unsubscribes** — `/u/$token` ([src/routes/u/$token.tsx](src/routes/u/$token.tsx)).
`POST` performs it, which is what RFC 8058 One-Click (Gmail's unsubscribe button)
sends; `GET` renders a confirmation page instead of acting, because mail clients and
security scanners prefetch links and would otherwise unsubscribe people who never
clicked. Messages carry both `List-Unsubscribe` and `List-Unsubscribe-Post`.

Both endpoints are reached by recipients who have no account, so they run as the
`anon` role against two `security definer` functions scoped strictly by token. They
are also exempt from the auth gate in [__root.tsx](src/routes/__root.tsx).

**Replies and bounces** — IONOS has no inbound webhook, so **Settings → Check replies
and bounces** scans every active mailbox's INBOX over IMAP. Mail from an address that
was sent to marks the prospect replied; bounce messages are parsed for the failed
recipient, which is then suppressed and cancelled from the queue. Envelopes only,
except for messages that already look like bounces.

> **Set `APP_URL`** before sending to real recipients. Tracking and unsubscribe links
> are built from it, and a `localhost` fallback resolves for nobody but you. The send
> report warns when links would be local.

## Data and auth

Every table carries a `user_id` and is protected by a row level security policy of
`auth.uid() = user_id`, so an account can only ever read or write its own rows. The
publishable key is safe to ship to the browser for exactly that reason.

The `service_role` key bypasses RLS entirely. It belongs in `.env` **only** for the
send worker, and only without a `VITE_` prefix — anything prefixed `VITE_` is inlined
into the browser bundle, which would hand every visitor full access to every row.

Only [OutreachProvider](src/store/outreach-store.tsx) talks to the database. Screens
use the `useOutreach()` hook and never issue queries themselves. Writes are
optimistic: local state updates immediately and the query is sent in the background,
raising a toast if it fails.

## Scripts

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start the dev server with HMR      |
| `npm run build`   | Production build                   |
| `npm run preview` | Serve the production build locally |
| `npm run lint`    | Run ESLint                         |
| `npm run format`  | Format with Prettier               |
| `npm run worker`  | Drain the send queue unattended    |

## Project layout

```
supabase/
  schema.sql      Tables, indexes, and RLS policies — run this once
src/
  components/     App shell, auth gate, chart, and the ui/ component library
  data/           Shared types and the first-run seed data
  hooks/          Shared React hooks
  lib/
    supabase.ts   Browser client
    db-types.ts   Row shapes and snake_case ↔ camelCase mappers
  routes/         File-based routes (dashboard, prospects, groups, …)
  store/
    auth-store.tsx      Session state, sign in / up / out
    outreach-store.tsx  All database reads and writes
  router.tsx      Router setup
  server.ts       SSR entry with error wrapper
  start.ts        Server middleware (error handling + CSRF)
```

Routes are file-based: adding a file under [src/routes/](src/routes/) regenerates
`src/routeTree.gen.ts` automatically while the dev server runs.

## Design notes

Clean, flat, minimal SaaS styling — white background, near-black text, hairline
borders, 12px rounded cards, no gradients or drop shadows. Accent blue `#2049D6`,
success green `#0E8A6A`, warning amber `#B4530A`, danger red `#A32B2B`, each with a
pale tint for badge backgrounds. IBM Plex Sans throughout, IBM Plex Mono for numbers
and timestamps. Sentence case everywhere. Responsive down to mobile, where the
sidebar collapses to a top bar.
