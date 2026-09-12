FROM node:22-alpine AS builder
WORKDIR /app
{{BUILD_ARGS}}
COPY src/package*.json ./
COPY src/ ./
RUN {{BUILD_COMMAND}}

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE {{CONTAINER_PORT}}
CMD ["nginx", "-g", "daemon off;"]
