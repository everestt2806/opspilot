# Demo app (M12): build tĩnh bằng Node, serve bằng nginx Alpine — image cuối < 50MB.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_API_URL được nạp lúc build vào bundle; mặc định trỏ tới app cùng VPS.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
