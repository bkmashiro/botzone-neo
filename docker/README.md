# Docker 构建与部署

## 快速开始

```bash
# 复制环境变量
cp .env.example .env

# 开发环境（热重载）
make dev

# 生产环境
make docker-up
```

## 镜像说明

### 生产镜像 (`docker/Dockerfile`)

多阶段构建：

1. **Builder** — `node:22-bookworm`，编译 NestJS 应用 + nsjail
2. **Runtime** — `node:22-bookworm-slim`，仅包含运行时依赖

运行时预装：
- `g++` / `python3` — Bot 编译
- `typescript` (全局) — TS Bot 编译
- `nsjail` — 沙箱隔离
- `nlohmann/json` — C++ Bot 头文件

### 开发镜像 (`docker/Dockerfile.dev`)

完整编译工具链，源码通过 volume 挂载实现热重载。

## 服务架构

| 服务 | 端口 | 说明 |
|------|------|------|
| judger | 3001 | NestJS 评测服务 |
| redis | 6379 (dev only) | 队列/缓存 |

## 安全注意事项

- judger 以 `privileged` 模式运行（nsjail 需要 namespace 权限）
- 生产环境网络设为 `internal: true`，不暴露 Redis 端口
- nsjail 将 Bot 进程降权到 `nobody` (uid 65534)
- 通过 `TRUST_IP` 限制允许提交任务的来源 IP

## nsjail 配置

沙箱配置文件：`docker/nsjail.cfg`

默认限制：
- 时间：5 秒
- 内存：256 MB
- CPU：5 秒
- 文件大小：64 MB
- 网络：禁用

## 常用命令

```bash
make dev            # 开发环境
make docker-up      # 生产环境
make docker-down    # 停止服务
make docker-logs    # 查看日志
make docker-build   # 重新构建（无缓存）
make clean          # 清理所有（含 volumes）
```
