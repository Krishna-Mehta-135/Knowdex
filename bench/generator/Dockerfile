FROM node:22.14.0-alpine3.21
WORKDIR /app
COPY bench ./bench
COPY bench/generator/server.mjs ./server.mjs
CMD ["node", "server.mjs"]
