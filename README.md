# Botzone Neo — NestJS Judger

基于 NestJS + Docker + nsjail 的 Botzone 评测服务，支持 Botzone 对局和 OJ 评测两种模式。

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

---

## Bot 开发快速上手

1. 在 `templates/` 目录中选择你使用的语言模板：
   - C++: `templates/cpp/bot-template.cpp`
   - Python: `templates/python/bot-template.py`
   - TypeScript: `templates/typescript/bot-template.ts`

2. 复制模板到你的项目，重命名为你的 Bot 文件

3. 修改 `makeDecision()` / `make_decision()` 函数，实现你的策略逻辑：

```python
# Python 示例
def make_decision(current_request, requests, responses, data):
    # current_request: 本轮裁判发来的请求
    # requests:        完整历史请求列表
    # responses:       完整历史响应列表
    # data:            上轮保存的持久化数据

    # 你的策略逻辑
    return "你的回复"
```

4. Bot 通过 stdin/stdout 与裁判交互（JSON 格式）：
   - **输入**: `{ "requests": [...], "responses": [...], "data": "...", "globaldata": "..." }`
   - **输出**: `{ "response": "你的回复", "debug": "调试信息", "data": "持久化数据" }`

5. **简化模式**：如果不需要 data/debug，直接输出纯文本即可：
   ```
   3 5
   ```
   等价于 `{ "response": "3 5" }`

---

## Judge 开发快速上手

1. 选择 Judge 模板：
   - C++: `templates/cpp/judge-template.cpp`
   - Python: `templates/python/judge-template.py`
   - TypeScript: `templates/typescript/judge-template.ts`

2. 裁判程序控制对局流程，分三个阶段：

   - **首轮（round=0）**：接收 initdata，生成初始数据，发送给各 Bot
   - **中间轮**：接收各 Bot 回复，判定并发送下一轮请求
   - **最终轮**：输出各 Bot 得分，结束对局

3. 裁判输出格式：

```jsonc
// 继续对局
{ "command": "request", "content": {"0": "发给Bot0", "1": "发给Bot1"}, "display": {} }

// 结束对局（得分 0~2：胜=2, 平=1, 负=0）
{ "command": "finish", "content": {"0": 2, "1": 0}, "display": {} }

// 首轮可附加 initdata（裁判生成的初始数据，如随机种子）
{ "command": "request", "content": {"0": "...", "1": "..."}, "initdata": "12345", "display": {} }
```

---

## API 文档

### POST /v1/judge

统一评测入口，返回 `202 Accepted`，评测异步执行，结果通过回调返回。

#### Botzone 对局请求

```json
{
  "type": "botzone",
  "game": {
    "judger": {
      "language": "cpp",
      "source": "#include <iostream>\n...",
      "limit": { "time": 5000, "memory": 256 }
    },
    "0": {
      "language": "python",
      "source": "import json\n...",
      "limit": { "time": 1000, "memory": 256 }
    },
    "1": {
      "language": "typescript",
      "source": "import { createInterface } ...",
      "limit": { "time": 1000, "memory": 256 }
    }
  },
  "callback": {
    "update": "http://backend/api/match/update",
    "finish": "http://backend/api/match/finish"
  },
  "initdata": "初始数据（可选，传给裁判首轮）",
  "runMode": "restart"
}
```

字段说明：
- `game`: 各参与者的代码，key 为 `"judger"` / `"0"` / `"1"` / ...
- `limit.time`: 每轮时间限制（毫秒）
- `limit.memory`: 内存限制（MB）
- `runMode`: `"restart"`（默认，每轮重启进程）或 `"longrun"`（常驻进程）

#### OJ 评测请求

```json
{
  "type": "oj",
  "language": "cpp",
  "source": "#include <iostream>\nint main() { int a,b; std::cin>>a>>b; std::cout<<a+b; }",
  "testcases": [
    { "id": 1, "input": "1 2\n", "expectedOutput": "3\n" },
    { "id": 2, "input": "100 200\n", "expectedOutput": "300\n" }
  ],
  "timeLimitMs": 1000,
  "memoryLimitMb": 256,
  "judgeMode": "standard",
  "callback": {
    "finish": "http://backend/api/oj/result"
  }
}
```

字段说明：
- `judgeMode`: `"standard"`（标准 diff 比较）或 `"checker"`（Special Judge）
- 使用 `"checker"` 时需额外提供：
  - `checkerSource`: checker 源代码
  - `checkerLanguage`: checker 语言
  - Checker 采用 Codeforces/testlib.h 格式：`checker input_file expected_file actual_file`
  - 退出码：0=AC, 1=WA, 2=PE, 其他=SE

---

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
├── domain/                  # 纯领域对象（零依赖）
│   ├── bot.ts               # Bot 类型定义
│   ├── verdict.ts           # 评测结果枚举
│   ├── match.ts             # 对局状态机
│   └── oj/                  # OJ 领域对象
├── application/             # 用例层
│   ├── run-match.usecase.ts # Botzone 对局用例
│   └── run-oj.usecase.ts    # OJ 评测用例
├── interface/               # HTTP 接口层
│   └── judge.controller.ts  # POST /v1/judge
├── infrastructure/          # 基础设施
│   ├── sandbox/             # ISandbox 沙箱抽象
│   ├── compile/             # 编译服务（LRU 缓存）
│   ├── data-store/          # data/globaldata 持久化
│   └── callback/            # 结果回报
├── strategies/              # Bot 运行策略（可插拔）
│   ├── botzone/             # Botzone 策略
│   │   ├── restart.strategy.ts  # 重启模式（默认）
│   │   └── longrun.strategy.ts  # 常驻模式（TODO）
│   └── oj/                  # OJ 策略
│       ├── diff.checker.ts      # 标准 diff 比较
│       └── custom.checker.ts    # Codeforces 格式 checker
templates/                   # 多语言 Bot/Judge 模板
docker/                      # Docker 相关配置
```

## 支持语言

| 语言       | 编译器/运行时         | Bot 模板 | Judge 模板 |
|-----------|---------------------|---------|-----------|
| C++       | g++ -O2 -std=c++17  | ✅       | ✅         |
| Python 3  | python3             | ✅       | ✅         |
| TypeScript| tsc + node          | ✅       | ✅         |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 服务监听端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `REDIS_HOST` | `redis` | Redis 主机 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `JUDGE_CAPABILITY` | `15` | 最大并发对局数 |
| `JUDGE_CONCURRENCY` | `15` | Bull 队列并发数 |
| `COMPILE_TIME_LIMIT_MS` | `10000` | 编译超时（毫秒） |
| `COMPILE_MEMORY_LIMIT_MB` | `512` | 编译内存限制（MB） |
| `MAX_MATCH_DURATION_MS` | `300000` | 单场对局最大时长（毫秒） |
| `SANDBOX_BACKEND` | `nsjail` | 沙箱后端：`nsjail`（生产）/ `direct`（开发） |
| `TRUST_IP` | `127.0.0.1` | 允许提交评测任务的 IP（逗号分隔） |
| `CORS_ORIGIN` | `*` | CORS 允许的来源（`*` 或具体域名） |

## 评测结果（Verdict）

| 代码 | 含义 | 说明 |
|------|------|------|
| OK   | 正常 | 对局/运行正常 |
| AC   | 正确 | OJ: 答案正确 |
| WA   | 错误 | OJ: 答案错误 |
| PE   | 格式错误 | OJ: Presentation Error |
| CE   | 编译错误 | 编译失败 |
| TLE  | 超时 | 超过时间限制 |
| MLE  | 内存超限 | 超过内存限制 |
| RE   | 运行时错误 | 程序崩溃/非零退出 |
| SE   | 系统错误 | 沙箱/checker 异常 |
