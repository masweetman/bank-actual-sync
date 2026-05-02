# backend/Dockerfile — Production (multi-stage)

# Stage 1: build TypeScript + compile native modules (bcrypt)
# node:22 (full Debian) ships with python3, make, g++ required by node-gyp
FROM node:22 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# Strip devDependencies so the production stage can copy a clean node_modules
RUN npm prune --omit=dev

# Stage 2: production runtime
# node_modules (including pre-compiled bcrypt binary) copied from builder —
# no npm, no build tools needed here
FROM node:22-slim AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist/
RUN mkdir -p /app/data
CMD ["node", "dist/server.js"]
