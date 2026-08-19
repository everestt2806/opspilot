FROM node:22-alpine
WORKDIR /app
COPY src/package*.json ./
RUN {{BUILD_COMMAND}}
COPY src/ .
EXPOSE {{CONTAINER_PORT}}
CMD ["sh", "-c", "{{START_COMMAND}}"]