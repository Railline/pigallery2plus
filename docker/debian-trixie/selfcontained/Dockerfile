#-----------------BUILDER-----------------
#-----------------------------------------
FROM node:22-trixie@sha256:8433642fe11d391a7ff1f702352ac1b0ea3e378d3fb2c22de2b292036d79cd2c AS builder
# LABEL maintainer="Patrik J. Braun"

# The full Node image already contains git and the native build toolchain. Sharp
# uses its compatible bundled libvips instead of Debian's older system package.

ARG PIGALLERY_REPOSITORY=https://github.com/Railline/pigallery2plus.git
ARG PIGALLERY_REF=main
RUN git clone --depth 1 --branch "$PIGALLERY_REF" "$PIGALLERY_REPOSITORY" /build
WORKDIR /build
RUN npm ci --include=optional \
    && mkdir -p /build/release/data/config \
    && mkdir -p /build/release/data/db \
    && mkdir -p /build/release/data/images \
    && mkdir -p /build/release/data/tmp \
    && npm run create-release -- --skip-opt-packages=ffmpeg-static,ffprobe-static --force-opt-packages
WORKDIR /build/release
RUN npm ci --omit=dev --include=optional \
    && npm audit signatures \
    && npm audit --omit=dev --audit-level=high \
    && npm cache clean --force

#-----------------MAIN--------------------
#-----------------------------------------
FROM node:22-trixie-slim@sha256:517aa41d78545cb1b8c67b13655b4c13ede1ee9df1da8aab54cd7434aefbcaf8 AS main
ARG NPM_VERSION=12.0.2
ARG BRACE_EXPANSION_VERSION=5.0.9
ARG IP_ADDRESS_VERSION=10.3.1
WORKDIR /app
ENV NODE_ENV=production \
    # overrides only the default value of the settings (the actualy value can be overwritten through config.json)
    default-Database-dbFolder=/app/data/db \
    default-Media-folder=/app/data/images \
    default-Media-tempFolder=/app/data/tmp \
    default-Extensions-folder=/app/data/config/extensions \
    # flagging dockerized environemnt
    PI_DOCKER=true

EXPOSE 80
ARG TARGETARCH
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && if [ "$TARGETARCH" = "amd64" ]; then \
        echo "Building for amd64, adding intel-media-va-driver" && \
        apt-get install -y --no-install-recommends intel-media-va-driver; \
    fi \
    && apt-get clean -q -y \
    && rm -rf /var/lib/apt/lists/*
# Extension installation needs npm at runtime. Replace the vulnerable npm bundled
# in the base image and its one dependency that is newer than npm's current pin.
RUN npm install --global --ignore-scripts --no-audit --fund=false \
        "npm@${NPM_VERSION}" \
        "brace-expansion@${BRACE_EXPANSION_VERSION}" \
        "ip-address@${IP_ADDRESS_VERSION}" \
    && rm -r /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && cp -a /usr/local/lib/node_modules/brace-expansion /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
    && rm -r /usr/local/lib/node_modules/brace-expansion \
    && rm -r /usr/local/lib/node_modules/npm/node_modules/ip-address \
    && cp -a /usr/local/lib/node_modules/ip-address /usr/local/lib/node_modules/npm/node_modules/ip-address \
    && rm -r /usr/local/lib/node_modules/ip-address \
    && npm cache clean --force
COPY --from=builder /build/release /app
COPY --from=builder /build/pigallery2plus-entrypoint.js /usr/local/bin/pigallery2plus-entrypoint.js

# Run build time diagnostics to make sure the app would work after build is finished
RUN ["node", "--expose-gc", "./src/backend/index", "--run-diagnostics", "--config-path=/app/diagnostics-config.json", "--Server-Log-level=silly"]
HEALTHCHECK --interval=40s --timeout=30s --retries=3 --start-period=60s \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:80/heartbeat',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

# after a extensive job (like video converting), pigallery calls gc, to clean up everthing as fast as possible
# Exec form entrypoint is need otherwise (using shell form) ENV variables are not properly passed down to the app
ENTRYPOINT ["node", "/usr/local/bin/pigallery2plus-entrypoint.js"]
