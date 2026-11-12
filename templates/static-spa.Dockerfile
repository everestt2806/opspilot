FROM node:22-alpine AS builder
WORKDIR /app
{{BUILD_ARGS}}
COPY src/package*.json ./
COPY src/ ./
RUN {{BUILD_COMMAND}} && \
    if [ ! -f /app/dist/index.html ]; then \
      echo "SPA build output is missing dist/index.html" >&2; exit 1; \
    fi

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf '%s\n' \
    'server {' \
    '  listen 80;' \
    '  server_name _;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '  location / { try_files $uri $uri/ /index.html; }' \
    '  location = /index.html { add_header Cache-Control "no-cache" always; }' \
    '  location /assets/ { try_files $uri =404; }' \
    '  location ~* \.(js|mjs|css|map|json|png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|eot|txt|xml|webmanifest)$ {' \
    '    try_files $uri =404;' \
    '  }' \
    '}' > /etc/nginx/conf.d/default.conf && nginx -t
EXPOSE {{CONTAINER_PORT}}
CMD ["nginx", "-g", "daemon off;"]
