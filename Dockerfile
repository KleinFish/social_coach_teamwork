# 零依赖镜像：只需要 Node 24（自带 node:sqlite）
FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app

# 只复制运行所需文件：源码、测试脚本、数据库都不会被打进镜像以外的地方
COPY package.json ./
COPY index.html styles.css app.js coach-engine.js server.js ./

RUN mkdir -p /data && chown -R node:node /app /data
USER node

# 数据必须落在挂载卷上，否则容器重建会丢
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
