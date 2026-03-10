# 安全加固指南

> 适用于 Leverage + Botzone-Neo 多服务器部署。

---

## 1. BOTZONE_CALLBACK_TOKEN 轮换

`BOTZONE_CALLBACK_TOKEN` 是 botzone-neo 回调 leverage-backend 时在 `Authorization` 请求头中携带的 Bearer Token，leverage-backend 会校验此 Token。

### 生成新 Token

```bash
openssl rand -hex 32
```

### 轮换步骤（零停机）

```
1. 生成新 Token（保留旧 Token）
2. 更新 leverage-backend .env 中 BOTZONE_CALLBACK_TOKEN 为新值
3. 滚动重启 leverage-backend（docker compose restart leverage-backend）
4. 更新 botzone-neo .env（Server 1 + 所有 Worker）中对应 Token
5. 滚动重启所有 botzone-neo 实例
6. 验证回调正常后，删除旧 Token
```

> ⚠️  **不要两端同时改**，会导致回调短暂失败。先改接收方（leverage-backend），再改发送方（botzone-neo）。

### 建议轮换周期

- 常规：每 90 天
- 泄露响应：立即轮换

---

## 2. TRUST_IP 配置

botzone-neo 通过 `TRUST_IP` 限制哪些 IP 可以提交评测任务（POST /v1/judge）。

### 配置项

```env
# .env（botzone-neo）
TRUST_IP=10.0.0.0/8,100.64.0.0/10   # Tailscale 默认 CIDR
```

### 推荐配置

| 场景 | TRUST_IP 值 |
|------|-------------|
| 仅 Server 1 leverage-backend（内网） | `172.16.0.0/12`（Docker bridge 网段） |
| Tailscale 网络内所有节点 | `100.64.0.0/10` |
| 多云 VPC + Tailscale | `10.0.0.0/8,100.64.0.0/10` |
| 开发环境（仅本机） | `127.0.0.1` |

### 如何查看当前 Docker 网段

```bash
docker network inspect botzone-internal | grep Subnet
```

> ⚠️  **不要将 TRUST_IP 设为 `0.0.0.0/0`**，否则任何人都可以提交任意代码执行任务。

---

## 3. Redis 认证（requirepass）

Redis 默认无密码，多服务器部署时必须配置密码，否则 Worker 连接的 Redis 在网络上是明文且无保护的。

### 设置密码

在 Server 1 的 `.env` 中：

```env
REDIS_PASSWORD=your_strong_redis_password  # openssl rand -hex 32
```

`docker-compose.server1.yml` 会自动将此密码传给 `redis-server --requirepass`。

在所有 Worker 的 `.env` 中，设置相同的密码：

```env
REDIS_PASSWORD=your_strong_redis_password
```

### 手动验证

```bash
# 测试带密码连接
redis-cli -h <SERVER1_TAILSCALE_IP> -a <PASSWORD> ping
# 应返回 PONG
```

### 禁用危险命令（可选，增强）

在 Redis 配置或 docker command 中添加：

```
--rename-command FLUSHALL ""
--rename-command FLUSHDB ""
--rename-command DEBUG ""
--rename-command CONFIG ""
```

---

## 4. 网络隔离建议

### 推荐拓扑

```
公网
  │
  ▼
[Nginx 80/443]  ← 唯一公网入口
  │
  ├─ /api → leverage-backend:3000   (内网)
  └─ /     → frontend static        (内网)

leverage-backend ──HTTP──► botzone-neo:3001   (Docker 内网 leverage-internal)
botzone-neo ──────────────► redis:6379         (Docker 内网 botzone-internal)

Worker 服务器
  └─ botzone-neo ──Tailscale──► redis:6379 on Server 1
```

### 防火墙规则（UFW 示例，Server 1）

```bash
# 只开放必要端口
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # HTTP
ufw allow 443/tcp      # HTTPS

# Redis 只允许 Tailscale 网段
ufw allow from 100.64.0.0/10 to any port 6379

# botzone-neo HTTP API（如需 Worker 外部访问，同上）
# ufw allow from 100.64.0.0/10 to any port 3001

ufw enable
```

### 防火墙规则（UFW 示例，Worker 服务器）

```bash
ufw allow 22/tcp      # SSH
# 其余端口全部关闭（Worker 只需出方向连 Redis）
ufw enable
```

### Tailscale 设置

```bash
# Server 1：确认 Redis 端口通过 Tailscale 可达
tailscale serve --bg tcp:6379

# Worker：通过 Tailscale 连接
REDIS_HOST=<SERVER1_TAILSCALE_IP>
```

> 🔒 **永远不要将 Redis 端口暴露到公网！** 使用 Tailscale、VPN 或 iptables 限制来源 IP。

---

## 5. 镜像与依赖安全

- 定期更新基础镜像（`redis:7-alpine`、`mariadb:10.11`、`node:22-alpine`）
- 使用 `docker scout` 或 `trivy` 扫描镜像漏洞：
  ```bash
  trivy image botzone-neo:latest
  ```
- CI/CD 中固定镜像 digest（`image: redis:7-alpine@sha256:...`），避免供应链攻击

---

## 6. nsjail 沙箱安全

botzone-neo 使用 nsjail 隔离代码执行，但容器本身需要 `privileged: true`。

**缓解措施：**
- 不在 botzone-neo 容器内运行其他服务
- 限制 `privileged` 容器的网络访问（使用 `internal: true` 网络或严格 iptables）
- 沙箱内代码无法访问宿主网络（nsjail 配置 `--disable_clone_newnet false`）

---

## 安全检查清单

| 项目 | 状态 | 说明 |
|------|------|------|
| REDIS_PASSWORD 已设置 | ☐ | openssl rand -hex 32 |
| BOTZONE_CALLBACK_TOKEN 已设置 | ☐ | openssl rand -hex 32 |
| JWT_ACCESS_SECRET / REFRESH_SECRET 已设置 | ☐ | 同上 |
| Redis 未暴露公网 | ☐ | 仅 Tailscale/VPN |
| TRUST_IP 已配置 | ☐ | 限制提交来源 |
| UFW/iptables 已配置 | ☐ | 白名单模式 |
| DB_PASSWORD / DB_ROOT_PASSWORD 已修改 | ☐ | 强密码 |
| INIT_SA_PASSWORD 首次启动后已修改 | ☐ | 通过 UI/API 修改 |
| CORS_ORIGIN 已设置为具体域名 | ☐ | 非 `*` |
