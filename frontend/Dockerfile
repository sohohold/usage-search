FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
RUN npm ci
COPY index.html ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
