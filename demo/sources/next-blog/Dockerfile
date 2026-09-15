# Demo app (M12): Next.js 14 SSR tĩnh — build bằng Node 22 Alpine rồi chạy next start.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_SITE_NAME được nội suyt (inlined) vào client bundle lúc build.
ARG NEXT_PUBLIC_SITE_NAME=OpsPilot Demo Blog
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
