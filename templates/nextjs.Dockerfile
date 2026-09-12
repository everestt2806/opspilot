FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
COPY src/package*.json ./
RUN npm ci
COPY src/ ./
RUN {{BUILD_COMMAND}}

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
EXPOSE {{CONTAINER_PORT}}
CMD ["sh", "-c", "{{START_COMMAND}}"]
