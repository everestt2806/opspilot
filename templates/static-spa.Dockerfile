FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY src/package*.json ./
RUN npm ci
COPY src/ ./
RUN {{BUILD_COMMAND}}

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE {{CONTAINER_PORT}}
CMD ["nginx", "-g", "daemon off;"]
