# backend/Dockerfile — Production (multi-stage)

# Stage 1: build TypeScript
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: production runtime
FROM node:22-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist/
RUN mkdir -p /app/data
CMD ["node", "dist/server.js"]
