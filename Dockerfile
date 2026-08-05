# Outreach Console — production image.
#
# Runs the web app. The send worker uses the same image with a different
# command (`npm run worker`), so deploy it as a second service rather than
# building anything separate.

# ---------------------------------------------------------------- build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_* values are inlined into the client bundle at build time, not read at
# runtime — so they must be present HERE. Setting them only on the running
# container produces a build that cannot reach Supabase.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

# --------------------------------------------------------------- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.mjs ./
COPY tsconfig.json ./
COPY worker ./worker
COPY src ./src

# Don't run as root.
USER node

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0

CMD ["node", "server.mjs"]
