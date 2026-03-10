# Botzone Neo — NestJS Judger

基于 NestJS + Docker + nsjail 的 Botzone 评测服务。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                    Botzone Judger                        │
│                                                          │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐   │
│  │  Judge    │───▶│  Bull     │───▶│  MatchRunner     │   │
│  │Controller │    │  Queue    │    │  (对局主控)       │   │
│  └──────────┘    └───────────┘    └────────┬─────────┘   │
│                       │                    │              │
│                       │           ┌────────▼─────────┐   │
│                  ┌────▼────┐      │  IBotRunStrategy  │   │
│                  │  Redis  │      │  ├─ Restart (默认) │   │
│                  └─────────┘      │  └─ Longrun (TODO)│   │
│                                   └────────┬─────────┘   │
│                                            │              │
│  ┌──────────┐    ┌───────────┐    ┌────────▼─────────┐   │
│  │ Compile  │    │ DataStore │    │  nsjail 沙箱      │   │
│  │ Service  │    │ Service   │    │  (安全隔离执行)    │   │
│  │ (LRU缓存)│    │ (data/    │    └──────────────────┘   │
│  │          │    │ globaldata)│                           │
│  └──────────┘    └───────────┘                           │
│                                                          │
│  支持语言: C++ │ Python3 │ TypeScript (Node.js)          │
└──────────────────────────────────────────────────────────┘
         │                    │
    ┌────▼────┐          ┌────▼────┐
    │ MariaDB │          │  Redis  │
    │ (共用)   │          │ (队列)  │
    └─────────┘          └─────────┘
```

## 快速启动

### 1. 环境准备

```bash
cp .env.example .env
```

### 2. Docker 启动（推荐）

```bash
# 生产环境
docker compose up -d

# 开发环境（支持热重载）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### 3. 本地开发

```bash
npm install
npm run start:dev
```

需要本地运行 Redis 和 MariaDB。

## API

### POST /v1/judge

提交评测任务。

```json
{
  "game": {
    "judger": { "language": "cpp", "source": "...", "limit": { "time": 5000, "memory": 256 } },
    "0": { "language": "python", "source": "...", "limit": { "time": 1000, "memory": 256 } },
    "1": { "language": "typescript", "source": "...", "limit": { "time": 1000, "memory": 256 } }
  },
  "callback": {
    "update": "http://backend/api/match/update",
    "finish": "http://backend/api/match/finish"
  },
  "initdata": "初始数据"
}
```

## 对局协议

Bot 通过 stdin/stdout 进行 JSON 交互：

- **输入**: `{ requests: string[], responses: string[], data: string, globaldata: string }`
- **输出**: `{ response: string, debug?: string, data?: string, globaldata?: string }`

裁判输出格式：

- **继续**: `{ command: "request", content: { "0": "...", "1": "..." }, display: {...} }`
- **结束**: `{ command: "finish", content: { "0": 1, "1": 0 }, display: {...} }`

## 项目结构

```
src/
├── main.ts                  # 入口
├── app.module.ts            # 根模块
├── judge/                   # 评测模块（控制器、服务、对局主控）
├── strategy/                # Bot 运行策略（可插拔）
├── sandbox/                 # nsjail 沙箱封装
├── compile/                 # 编译模块（LRU 缓存）
├── data-store/              # data/globaldata 持久化
└── callback/                # 结果回报
templates/                   # 多语言 Bot/Judge 模板
docker/                      # Docker 相关配置
```

## 支持语言

| 语言       | 编译器/运行时   | Bot 模板 | Judge 模板 |
|-----------|--------------|---------|-----------|
| C++       | g++ -O2 -std=c++17 | ✅ | ✅ |
| Python 3  | python3      | ✅       | ✅         |
| TypeScript| tsc + node   | ✅       | ✅         |
