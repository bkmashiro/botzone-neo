# ============================================================
# Stage 1: Builder — 编译 NestJS 应用 + 安装 nsjail
# ============================================================
FROM node:20-bookworm AS builder

WORKDIR /app

# 安装系统编译依赖（nsjail 编译需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    pkg-config \
    libprotobuf-dev \
    protobuf-compiler \
    libnl-3-dev \
    libnl-route-3-dev \
    && rm -rf /var/lib/apt/lists/*

# 编译安装 nsjail
RUN git clone --depth 1 https://github.com/google/nsjail.git /tmp/nsjail \
    && cd /tmp/nsjail \
    && make -j$(nproc) \
    && cp /tmp/nsjail/nsjail /usr/bin/nsjail \
    && rm -rf /tmp/nsjail

# 安装 Node.js 依赖
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# 复制源码并构建
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ============================================================
# Stage 2: Runtime — 仅包含必要运行时
# ============================================================
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# 安装运行时依赖：g++, python3 + pip, nsjail 运行时库
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    python3 \
    python3-pip \
    libnl-3-200 \
    libnl-route-3-200 \
    libprotobuf32 \
    && rm -rf /var/lib/apt/lists/*

# 安装 nlohmann/json 头文件（C++ Bot 依赖）
RUN mkdir -p /usr/local/include/nlohmann \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -sL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp \
       -o /usr/local/include/nlohmann/json.hpp \
    && apt-get purge -y curl ca-certificates && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 安装全局 TypeScript（Bot 编译用）
RUN npm install -g typescript

# 从 builder 复制 nsjail
COPY --from=builder /usr/bin/nsjail /usr/bin/nsjail

# 从 builder 复制应用
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# 复制模板和 nsjail 配置
COPY templates/ ./templates/
COPY docker/nsjail.cfg /etc/nsjail/default.cfg

# 创建工作目录
RUN mkdir -p /app/.cache /app/.data

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/main.js"]
