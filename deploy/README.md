# Leverage + Botzone-Neo 多服务器部署指南

> 本指南覆盖从零开始的生产部署，包括单控制节点 + 多 Worker 水平扩展方案。

---

## 系统架构图

```
                        ┌─────────────────────────────────────────────────────┐
                        │               Server 1 (Control Node)               │
                        │                                                     │
  用户浏览器             │  ┌──────────┐    ┌──────────────────┐              │
  ──────────► 80/443 ──►│  │  Nginx   │───►│ leverage-frontend│ (静态文件)   │
                        │  │(反向代理) │    └──────────────────┘              │
                        │  │          │    ┌──────────────────┐              │
                        │  │  /api ──►│───►│ leverage-backend  │             │
                        │  └──────────┘    │   (NestJS:3000)   │             │
                        │                  └────────┬─────────┘              │
                        │                           │ HTTP                    │
                        │                           ▼                         │
                        │                  ┌──────────────────┐              │
                        │                  │  botzone-neo      │             │
                        │                  │  (Worker:3001)    │             │
                        │                  │  [co-located]     │             │
                        │                  └────────┬─────────┘              │
                        │                           │                         │
                        │         ┌─────────────────┼───────────┐            │
                        │         ▼                 ▼           ▼            │
                        │  ┌──────────┐    ┌──────────────┐                  │
                        │  │ MariaDB  │    │    Redis     │ ←── 共享队列     │
                        │  │  :3306   │    │    :6379     │                  │
                        │  └──────────┘    └──────┬───────┘                  │
                        └─────────────────────────┼───────────────────────── ┘
                                                   │ Tailscale / VPN
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                    ┌─────────▼──────────┐         │         ┌──────────▼─────────┐
                    │  Server 2 (Worker) │         │         │  Server N (Worker) │
                    │  botzone-neo:3001  │         │         │  botzone-neo:3001  │
                    │  (无状态，可随时   │   ...   │         │  (无状态，可随时   │
                    │   扩容/缩容)       │         │         │   扩容/缩容)       │
                    └────────────────────┘         │         └────────────────────┘
                                                   │
                              回调: botzone-neo ──►│──► leverage-backend (HTTPS)
                              (BOTZONE_CALLBACK_URL 指向 Server 1 公网地址)
```

**数据流说明：**
1. 用户提交代码 → leverage-backend 接收
2. leverage-backend 调用 botzone-neo HTTP API（`POST /v1/judge`）提交评测任务
3. botzone-neo 将任务推入 Redis Bull 队列
4. 所有 Worker（Server 1 co-located + Server 2..N）竞争消费队列
5. Worker 执行评测后，通过 `BOTZONE_CALLBACK_URL` 回调 leverage-backend

---

## 前置条件

- Docker Engine ≥ 24.x + Docker Compose V2（`docker compose`，非 `docker-compose`）
- 操作系统：Ubuntu 22.04 / Debian 12（推荐）
- Server 1 需要 ≥ 4 vCPU / 8GB RAM（运行全部服务）
- Worker 服务器需要 ≥ 2 vCPU / 4GB RAM
- 所有服务器通过 **Tailscale** 或私有 VPN 互联（Redis 通信安全）
- nsjail 需要内核支持 `user_namespaces`（Ubuntu 22.04 默认开启）

---

## Server 1 部署步骤

### 1. 安装基础依赖

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER
newgrp docker

# 安装 Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### 2. 克隆代码仓库

```bash
mkdir -p /opt/leverage-stack && cd /opt/leverage-stack

git clone https://github.com/yourorg/leverage-backend-neo.git
git clone https://github.com/yourorg/leverage-frontend-neo.git
git clone https://github.com/yourorg/botzone-neo.git
```

目录结构应如下：
```
/opt/leverage-stack/
├── leverage-backend-neo/
├── leverage-frontend-neo/
├── botzone-neo/
│   └── deploy/          ← 本文件所在目录
└── .env                 ← Server 1 环境变量文件
```

### 3. 配置环境变量

```bash
cd /opt/leverage-stack
cp botzone-neo/deploy/.env.server1.example .env
nano .env   # 或 vim .env
```

**必须修改的配置项：**

| 变量 | 说明 |
|------|------|
| `DB_PASSWORD` | 数据库密码，使用强密码 |
| `DB_ROOT_PASSWORD` | MariaDB root 密码 |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` 生成 |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` 生成（与上面不同） |
| `BASE_URL` | 服务器公网地址，如 `https://oj.example.com` |
| `REDIS_PASSWORD` | `openssl rand -hex 32` 生成 |
| `REDIS_BIND_IP` | Server 1 的 Tailscale IP（`tailscale ip -4`） |
| `BOTZONE_CALLBACK_URL` | `https://your-domain.com/api/judge/callback` |
| `BOTZONE_CALLBACK_TOKEN` | `openssl rand -hex 32` 生成 |
| `BOTZONE_API_KEY` | `openssl rand -hex 32` 生成 |
| `CORS_ORIGIN` | 前端域名，如 `https://oj.example.com` |
| `INIT_SA_PASSWORD` | 初始管理员密码（首次启动后立即修改） |

### 4. 启动所有服务

```bash
cd /opt/leverage-stack
docker compose -f botzone-neo/deploy/docker-compose.server1.yml up -d
```

### 5. 验证服务状态

```bash
# 查看所有容器状态
docker compose -f botzone-neo/deploy/docker-compose.server1.yml ps

# 查看日志
docker compose -f botzone-neo/deploy/docker-compose.server1.yml logs -f leverage-backend
docker compose -f botzone-neo/deploy/docker-compose.server1.yml logs -f botzone-neo

# 健康检查
curl http://localhost/health          # 通过 Nginx（若域名未配置，改 http://127.0.0.1）
curl http://localhost:3001/health     # botzone-neo 直接（内网）
```

### 6. 检查 Tailscale IP（用于 Worker 配置）

```bash
tailscale ip -4
# 输出类似：100.73.231.27
# Worker 服务器需要此 IP 来连接 Redis
```

---

## Server 2..N 部署步骤（Worker 扩容）

### 1. 安装基础依赖

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER
newgrp docker

# 安装 Tailscale 并加入同一 tailnet
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### 2. 克隆 botzone-neo 仓库

```bash
mkdir -p /opt/botzone && cd /opt/botzone
git clone https://github.com/yourorg/botzone-neo.git
```

### 3. 配置环境变量

```bash
cd /opt/botzone/botzone-neo
cp deploy/.env.worker.example .env
nano .env
```

**Worker 必填项：**

| 变量 | 说明 |
|------|------|
| `REDIS_HOST` | Server 1 的 Tailscale IP（例如 `100.73.231.27`） |
| `REDIS_PASSWORD` | 与 Server 1 相同的 Redis 密码 |
| `JUDGE_CONCURRENCY` | 根据服务器 CPU 核数调整（见下方说明） |

### 4. 构建并启动 Worker

```bash
cd /opt/botzone/botzone-neo
docker compose -f deploy/docker-compose.worker.yml up -d --build
```

### 5. 验证 Worker 连接

```bash
# 检查 Worker 健康状态
curl http://localhost:3001/health

# 检查 Worker 是否正在消费队列（在 Server 1 上）
docker exec leverage-redis redis-cli -a <REDIS_PASSWORD> INFO clients
# connected_clients 应增加（每个 Worker 约 2~5 个连接）
```

---

## 环境变量参考表

### Server 1 变量

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `NODE_ENV` | `development` | ✅ | 必须设为 `production` |
| `PORT` | `3000` | - | leverage-backend 监听端口 |
| `DB_HOST` | `mariadb` | - | 数据库主机（Docker 内部） |
| `DB_PORT` | `3306` | - | 数据库端口 |
| `DB_DATABASE` | `leverage` | ✅ | 数据库名 |
| `DB_USERNAME` | `leverage` | ✅ | 数据库用户 |
| `DB_PASSWORD` | - | ✅ | 数据库密码（强密码） |
| `DB_ROOT_PASSWORD` | - | ✅ | MariaDB root 密码 |
| `DB_POOL_SIZE` | `20` | - | 连接池大小 |
| `JWT_ACCESS_SECRET` | - | ✅ | JWT Access Token 密钥 |
| `JWT_REFRESH_SECRET` | - | ✅ | JWT Refresh Token 密钥 |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | - | Access Token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | - | Refresh Token 有效期 |
| `BASE_URL` | `http://localhost:3000` | ✅ | 公网地址（用于回调） |
| `REDIS_HOST` | `redis` | - | Redis 主机（Docker 内部） |
| `REDIS_PORT` | `6379` | - | Redis 端口 |
| `REDIS_PASSWORD` | - | ⚠️ | Redis 密码（生产必填） |
| `REDIS_BIND_IP` | `127.0.0.1` | ⚠️ | Redis 对外绑定 IP（Tailscale IP） |
| `BOTZONE_ENABLED` | `false` | ✅ | 必须设为 `true` |
| `BOTZONE_BASE_URL` | - | ✅ | botzone-neo 内网地址 |
| `BOTZONE_CALLBACK_URL` | - | ✅ | 回调 URL（公网可达） |
| `BOTZONE_API_KEY` | - | ✅ | botzone-neo 请求鉴权 key |
| `BOTZONE_CALLBACK_TOKEN` | - | ✅ | 回调 Token（leverage-backend 校验） |
| `CORS_ORIGIN` | `*` | ✅ | 前端域名（非 `*`） |
| `JUDGE_CONCURRENCY` | `15` | - | Bull 队列并发数 |
| `SANDBOX_BACKEND` | `nsjail` | - | 沙箱后端 |
| `INIT_SA_USERNAME` | `admin` | ⚠️ | 初始 SA 用户名 |
| `INIT_SA_PASSWORD` | - | ✅ | 初始 SA 密码（强密码） |

### Worker 变量

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `REDIS_HOST` | - | ✅ | Server 1 的 Tailscale IP |
| `REDIS_PORT` | `6379` | - | Redis 端口 |
| `REDIS_PASSWORD` | - | ✅ | 与 Server 1 相同的密码 |
| `PORT` | `3001` | - | botzone-neo 监听端口 |
| `JUDGE_CONCURRENCY` | `15` | - | 并发评测数（按 CPU 调整） |
| `COMPILE_TIME_LIMIT_MS` | `10000` | - | 编译超时（ms） |
| `COMPILE_CACHE_SIZE` | `200` | - | 编译 LRU 缓存大小 |
| `MAX_MATCH_DURATION_MS` | `300000` | - | 单场对局最大时长（ms） |
| `SANDBOX_BACKEND` | `nsjail` | - | 沙箱后端 |
| `BOTZONE_IMAGE` | - | - | 预构建 Docker 镜像（可选） |

---

## 健康检查端点

| 服务 | 端点 | 说明 |
|------|------|------|
| leverage-backend | `GET /health` | NestJS 健康检查 |
| botzone-neo | `GET /health` | 服务健康 + Redis 连接 |
| Nginx | `HEAD /` | 502 = 后端不可达 |

```bash
# Server 1 综合健康检查
curl -s http://localhost/health | jq .
curl -s http://localhost:3001/health | jq .

# Worker 健康检查（在 Worker 服务器上）
curl -s http://localhost:3001/health | jq .
```

---

## 升级步骤

### 升级 botzone-neo（所有节点）

```bash
# 1. 在所有 Worker 节点（并行执行）
cd /opt/botzone/botzone-neo
git pull origin main
docker compose -f deploy/docker-compose.worker.yml up -d --build
# Worker 升级期间，其他 Worker 仍在消费队列，无停机

# 2. 在 Server 1 升级 co-located Worker
cd /opt/leverage-stack
git -C botzone-neo pull origin main
docker compose -f botzone-neo/deploy/docker-compose.server1.yml up -d --build botzone-neo
```

### 升级 leverage-backend

```bash
cd /opt/leverage-stack
git -C leverage-backend-neo pull origin main

# Migrations 会在启动时自动执行（NODE_ENV=production）
docker compose -f botzone-neo/deploy/docker-compose.server1.yml up -d --build leverage-backend
```

### 升级 leverage-frontend

```bash
cd /opt/leverage-stack
git -C leverage-frontend-neo pull origin main

# 重新构建前端
docker compose -f botzone-neo/deploy/docker-compose.server1.yml up -d --build leverage-frontend

# Nginx 重新加载静态文件（volume 自动更新，通常无需重启）
docker compose -f botzone-neo/deploy/docker-compose.server1.yml restart nginx
```

### 回滚

```bash
# 回滚到上个 tag
git -C botzone-neo checkout v1.2.3
docker compose -f botzone-neo/deploy/docker-compose.server1.yml up -d --build botzone-neo
```

---

## 水平扩展说明

### 添加 Worker 服务器

水平扩展是无状态的，只需：

1. 在新服务器上安装 Docker + Tailscale
2. 克隆 botzone-neo 仓库
3. 复制 `.env.worker.example` 并填写 Redis 连接信息
4. 执行 `docker compose -f deploy/docker-compose.worker.yml up -d --build`

**无需修改 Server 1 任何配置**，Redis Bull 队列会自动将任务分配给所有在线 Worker。

### JUDGE_CONCURRENCY 调优

| 场景 | 建议值 | 说明 |
|------|--------|------|
| 轻量测试 / 开发 | `5` | 减少资源占用 |
| 标准生产（4 vCPU） | `15` | 默认值 |
| 高性能（8 vCPU） | `20~30` | CPU 密集型评测建议不超过 CPU × 4 |
| 内存密集型评测 | 适当降低 | 确保每个并发任务有足够内存 |

```env
# Worker .env
JUDGE_CONCURRENCY=20   # 根据服务器 CPU 核数 × 2~4 设置
```

> ⚠️  并发数不是越高越好。过高会导致 nsjail 内存压力、OOM kill，反而降低吞吐量。建议通过压测确定最优值。

### Redis 网络暴露

Redis 必须在 Server 1 上对 Worker 服务器可达，推荐方案：

**方案 A（推荐）：Tailscale**
```
# Server 1 .env
REDIS_BIND_IP=100.73.231.27   # Server 1 的 Tailscale IP

# Worker .env
REDIS_HOST=100.73.231.27      # 同上
```

**方案 B：VPC 私网**
```
# 适用于同一云厂商的 VPC 内网
REDIS_BIND_IP=10.0.0.x        # Server 1 的 VPC 内网 IP
REDIS_HOST=10.0.0.x
```

**方案 C：SSH 隧道（不推荐生产使用）**
```bash
# 在 Worker 上创建 SSH 隧道
ssh -L 6379:localhost:6379 user@server1 -N
REDIS_HOST=127.0.0.1
```

> 🔒 无论选择哪种方案，**必须设置 `REDIS_PASSWORD`** 并通过防火墙限制 6379 端口访问来源。

---

## 常见问题

### Worker 无法连接 Redis

```bash
# 在 Worker 服务器测试连通性
redis-cli -h <SERVER1_TAILSCALE_IP> -p 6379 -a <PASSWORD> ping

# 检查 Server 1 防火墙
sudo ufw status
# 应有：100.64.0.0/10 ALLOW on 6379

# 检查 Redis 实际监听地址
docker exec leverage-redis redis-cli config get bind
```

### botzone-neo 健康检查失败

```bash
docker logs botzone-neo-worker --tail 50
# 常见原因：Redis 连接失败、nsjail 权限不足（需 privileged: true）
```

### 前端构建失败

```bash
docker logs leverage-frontend --tail 50
# 常见原因：Node 内存不足，增大 Docker 内存限制
# 或：pnpm install 网络超时，检查服务器网络
```

---

## 安全加固

详见 [SECURITY.md](./SECURITY.md)
