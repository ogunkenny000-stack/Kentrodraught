# Kentro Draughts, optimized for a small persistent host.
# Two stages: native engine + frontend are built off-line from the runtime;
# the final container has no compiler, Vite dev server, or build cache.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends g++ make \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# These two keys are designed to be public and are compiled into the web app.
# NEVER pass the Supabase secret key as a build arg.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/nd_upgraded/scan_nigerian ./nd_upgraded/scan_nigerian
COPY --from=builder /app/nd_upgraded/data/eval_nigerian ./nd_upgraded/data/eval_nigerian
COPY --from=builder /app/nd_upgraded/scan.ini ./nd_upgraded/scan.ini
COPY --from=builder /app/data/eval_nigerian ./data/eval_nigerian
COPY --from=builder /app/supabase ./supabase
# Game records and other local mutable state live here. Mount /app/data
# as a persistent volume so a container restart does not discard records.
RUN chown -R node:node /app/data /app/nd_upgraded
USER node
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
