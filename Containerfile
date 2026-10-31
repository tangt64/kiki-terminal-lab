FROM docker.io/node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./client
COPY scripts/licenses.mjs ./scripts/licenses.mjs
COPY scripts/prepare-platform-assets.mjs ./scripts/prepare-platform-assets.mjs
COPY platform ./platform
COPY vite.config.js ./
RUN npm run build && npm prune --omit=dev

FROM registry.k8s.io/kubectl:v1.30.14 AS kubectl-runtime

FROM docker.io/node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssh-client netcat-openbsd iproute2 python3 skopeo fonts-nanum && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4080 HEAT_DRIVER=openstack
ENV DATA_ROOT_DIR=/app/data
RUN mkdir -p /app/data /app/secrets && chown node:node /app/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/platform/dist ./platform/dist
COPY --chown=node:node package.json LICENSE NOTICE.md AUTHORS.md ./
COPY --chown=node:node server ./server
COPY --chown=node:node platform/server ./platform/server
COPY --chown=node:node platform/shared ./platform/shared
COPY --chown=node:node platform/client/src/lab-exam-examples.js ./platform/client/src/lab-exam-examples.js
COPY --chown=node:node platform/scripts ./platform/scripts
COPY --chown=node:node platform/heat-templates ./platform/heat-templates
COPY --from=kubectl-runtime /bin/kubectl /usr/local/bin/kubectl
RUN chmod +x /app/platform/scripts/registry-image-mirror.sh
USER node
EXPOSE 4080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.js"]
