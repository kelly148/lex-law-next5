# ============================================================
# Stage 1: deps — install all dependencies (including devDeps)
# ============================================================
FROM node:22-alpine AS deps

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
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy full source
COPY . .

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
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Railway injects PORT at runtime; default to 3001 for local testing
ENV PORT=3001
EXPOSE 3001

# Health check — Railway uses /api/health
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["node", "dist/server/index.js"]
