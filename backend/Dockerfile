# backend/Dockerfile — Production
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY data/ ./data/

CMD ["node", "dist/server.js"]
