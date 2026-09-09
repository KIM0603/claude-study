# HappyLocal - 프론트(정적) + TourAPI 프록시 서버를 한 컨테이너로 실행합니다.
#
# 프론트를 서버와 같은 오리진에서 서빙하므로 CORS 문제가 없고,
# TourAPI 서비스키는 컨테이너 환경변수에만 존재해 브라우저로 나가지 않습니다.
#
#   docker build -t happylocal .
#   docker run -p 8787:8787 --env-file server/.env happylocal

FROM node:20-alpine

WORKDIR /app

# 의존성 레이어를 먼저 만들어 코드만 바뀔 때 재설치를 피합니다.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# 프론트(happylocal_v2.html, images/)와 서버 소스를 함께 넣습니다.
# config.js 가 server/ 의 상위를 정적 루트로 잡기 때문에 둘 다 필요합니다.
COPY . .

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# db.json 은 컨테이너 파일시스템에 쓰입니다.
# 재배포 시 주문·후기가 초기화되므로, 유지가 필요하면 볼륨을 붙이세요:
#   docker run -v happylocal-data:/app/server/data ...
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server/src/index.js"]
