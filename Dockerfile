# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

USER node

# standalone bundles the server and its minimal node_modules; server.js lands at /app/server.js
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# NOTE: this app DOES have a public/ folder (public/firmin-logo.png, tracked in git
# and rendered in the dashboard header at app/page.tsx:950). Omitting this line does
# not fail the build, it ships a broken logo. Remove only if the asset goes away.
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
