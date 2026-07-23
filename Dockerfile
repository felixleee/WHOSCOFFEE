# WHOSCOFFEE 공용 서버 (Fly.io)
# 의존성 제로 — node:http + node:sqlite(Node 24 내장) 이라 npm install 불필요
FROM node:24-slim
WORKDIR /app

COPY server.js db.js icon.ico ./
COPY public ./public

ENV PORT=8080
ENV WC_DATA_DIR=/data
EXPOSE 8080

CMD ["node", "server.js"]
