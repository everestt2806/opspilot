FROM node:22-alpine AS builder
WORKDIR /app
{{BUILD_ARGS}}
COPY src/package*.json ./
COPY src/ ./
RUN mkdir -p public && {{BUILD_COMMAND}}

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE {{CONTAINER_PORT}}
CMD ["sh", "-c", "{{START_COMMAND}}"]
