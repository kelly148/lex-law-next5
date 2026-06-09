# ============================================================
# Stage 1: deps — install all dependencies (including devDeps)
# ============================================================
FROM node:22-alpine3.21 AS deps

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy lockfile and workspace config first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Install ALL deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: builder — compile client (Vite) + server (esbuild)
# ============================================================
FROM node:22-alpine3.21 AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy full source
COPY . .

# OPS-DEPLOY-PIPELINE-1: cache-bust the client/server build PER COMMIT.
# Railway's build-layer cache was reusing a stale `vite build`, serving a frontend
# compiled before merged source changes (e.g. MR-CAL-4B native feedback cards).
# Railway injects RAILWAY_GIT_COMMIT_SHA at build; referencing it in this RUN makes
# the layer's cache key change on every commit, forcing a fresh `vite build` so a
# merged frontend change can never be masked by a stale cached layer again.
# (NO_CACHE=1 is also set on the Railway service as a belt-and-suspenders.)
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN echo "client/server build for commit ${RAILWAY_GIT_COMMIT_SHA}"

# Build client (Vite) + server (esbuild) in one step
# Uses local binaries from node_modules/.bin via pnpm exec
RUN pnpm exec tsc --noEmit && \
    pnpm exec vite build && \
    pnpm exec esbuild src/server/index.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=esm \
      --outfile=dist/server/index.js \
      --packages=external

# ============================================================
# Stage 3: runner — production image (no devDeps, no source)
# ============================================================
FROM node:22-alpine3.21 AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# FOLD-DEPLOY-MIGRATE: include the additive SQL migrations + the pre-deploy runner in the
# RUNTIME image so Railway's deploy.preDeployCommand can apply pending additive migrations
# before serving new code. (mysql2 is already present — it is a production dependency.)
# Without these COPYs the runner/files would be absent from the slim runner stage.
COPY --from=builder /app/scripts/apply-prod-migrations.mjs ./scripts/apply-prod-migrations.mjs
COPY --from=builder /app/src/server/db/migrations ./src/server/db/migrations

# MATERIALS-DROPZONE-1 Inc B: bundle the local OCR language model (tesseract.js langPath ->
# assets/tessdata/eng.traineddata) into the runtime image so image/scanned-PDF OCR runs with NO
# runtime CDN fetch (no-egress). Pure data asset; no system package, no native addon.
COPY --from=builder /app/assets ./assets
# Fail the build LOUDLY if the OCR model is missing (e.g. asset not committed) rather than silently
# shipping a dead no-egress OCR feature that would only error at first use.
RUN test -f ./assets/tessdata/eng.traineddata || (echo "ERROR: OCR model assets/tessdata/eng.traineddata is missing from the image" && exit 1)

# OPS-DEPLOY-PIPELINE-1: bake a version stamp into the image so /api/version can
# report exactly which commit and build is running (stale-deploy detection).
# Referencing the commit SHA keeps this layer fresh per commit.
ARG RAILWAY_GIT_COMMIT_SHA=local
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "${RAILWAY_GIT_COMMIT_SHA}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ./dist/version.json

# Railway injects PORT at runtime; default to 3001 for local testing
ENV PORT=3001
EXPOSE 3001

# Health check — Railway uses /api/health
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["node", "dist/server/index.js"]
