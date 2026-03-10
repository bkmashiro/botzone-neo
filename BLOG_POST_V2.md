# 构建生产级代码评测平台：Botzone Neo + Leverage 全栈集成复盘

> 从评测引擎到完整 OJ 平台，145+ commits，675 个测试，从零到可水平扩展，一夜完成。

---

## 一、为什么要重写

原有的 Leverage OJ 评测方案是"一个 NestJS controller + 多台评测机 client"的架构，问题很明显：

- 评测机是有状态的长连接 client，故障后无法自动恢复
- 评测任务没有持久化，重启丢任务
- 不支持 Botzone 游戏 AI 对战（只有标准 OJ 评测）
- 前端没有逐测试点结果、Botzone 回放这些功能
- 代码和测试都很少，难以维护

这次目标是从头写一个真正生产可用的评测系统，包含：
- **Botzone Neo**：独立的评测 Judge Service
- **Leverage 后端**：集成 Botzone Neo 作为 Judge Provider
- **Leverage 前端**：评测结果展示 + Botzone 游戏回放

---

## 二、整体架构

```
┌─────────────────────────── Server 1 ────────────────────────────┐
│                                                                    │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐   │
│  │  Leverage    │    │  Leverage        │    │  Botzone Neo  │   │
│  │  Frontend    │───▶│  Backend         │───▶│  Worker       │   │
│  │  (Nuxt 4)   │    │  (NestJS)        │    │  (NestJS)     │   │
│  └──────────────┘    └────────┬─────────┘    └───────┬───────┘   │
│                               │ callback              │           │
│                               └───────────────────────┘           │
│                                           │                        │
│                               ┌───────────▼───────────┐           │
│                               │  Redis (shared queue) │           │
│                               └───────────────────────┘           │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────── Server 2..N ──────────────────────────────┐
│                                                                    │
│  ┌────────────────────────────────────┐                           │
│  │  Botzone Neo Worker (stateless)    │──────────▶ Redis          │
│  └────────────────────────────────────┘           (Server 1)      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

核心设计原则：
- **Botzone Neo 完全无状态**：所有任务状态在 Redis，Worker 可随意横向扩容
- **Leverage 负责业务**：权限、持久化、展示；不负责执行评测
- **异步 + Callback**：Leverage 投递任务后立即返回，结果通过 Callback 回写

---

## 三、Botzone Neo：评测引擎设计

### 3.1 DDD 分层

```
src/
├── domain/           # 纯业务逻辑，零框架依赖
│   ├── verdict.ts    # AC/WA/TLE/RE/CE/SE 枚举
│   ├── oj/           # OJTask / TestcaseResult / IChecker
│   └── botzone/      # MatchTask / BotOutput / IJob
│
├── infrastructure/   # I/O 适配层
│   ├── compile/      # CompileService：LRU 缓存，多语言
│   ├── sandbox/      # ISandbox：DirectSandbox / NsjailSandbox
│   └── callback/     # CallbackService：重试 + timeout + X-Request-ID
│
├── strategies/       # 可插拔算法
│   ├── botzone/      # RestartStrategy / StandardStrategy / CheckerStrategy / LongrunStrategy
│   └── oj/           # DiffChecker / CustomChecker（Codeforces 格式）
│
├── application/      # Use Case：组合 domain + infrastructure
│   ├── run-match.usecase.ts
│   └── run-oj.usecase.ts
│
└── interface/        # HTTP 控制器 + Bull 队列 + DTOs
```

Domain 层没有任何 NestJS import，测试极快，逻辑清晰。

### 3.2 ISandbox：最关键的抽象

```typescript
export interface ISandbox {
  execute(opts: SandboxExecuteOptions): Promise<SandboxResult>;
}

// 开发环境 / Mac
@Injectable()
export class DirectSandbox implements ISandbox {
  async execute(opts): Promise<SandboxResult> {
    const child = spawn(opts.compiled.binary, opts.compiled.args, {
      timeout: opts.limit.timeMs,
      maxBuffer: MAX_OUTPUT_SIZE,
    });
    // ...
  }
}

// 生产 Linux
@Injectable()
export class NsjailSandbox implements ISandbox {
  async execute(opts): Promise<SandboxResult> {
    // 包裹 nsjail --config_file ... -- binary args
    // cgroups + seccomp + chroot + rlimit
  }
}
```

切换只需环境变量 `SANDBOX_BACKEND=nsjail|direct`，业务代码零改动。

### 3.3 Botzone 协议：四种交互模式

Botzone 的核心是裁判程序（judger）通过 stdin/stdout 与 bot 程序通信：

```
Engine → Judger stdin: [当前游戏日志 JSON]
Judger stdout → Engine: {"command":"request","content":{"0":"data-for-bot0"}}
Engine → Bot-0 stdin: "data-for-bot0"
Bot-0 stdout → Engine: {"response":"my-move"}
Engine → Judger stdin: [更新后的游戏日志]
...
Judger stdout → Engine: {"command":"finish","content":{"0":1,"1":0},"display":"..."}
```

四种策略，适应不同 bot 实现需求：

| 策略 | Bot 进程生命周期 | 适用场景 |
|------|-----------------|---------|
| `restart` | 每轮重启 | 无状态 bot，最简单 |
| `standard` | 全程持续 | 有状态 bot，每轮收完整日志 |
| `checker` | 全程持续 | Codeforces checker 格式（exit 0/1/2/3） |
| `longrun` | SIGSTOP/SIGCONT | 需要初始化的 bot，零重启开销 |

### 3.4 编译 LRU 缓存

编译是评测中最慢的操作，Botzone 多局对战中同一 bot 要打多场。用 LRU 缓存彻底消除重复编译：

```typescript
const key = `${language}:${createHash('sha256').update(source).digest('hex')}`;
if (this.cache.has(key)) {
  this.cacheHits.inc();    // Prometheus counter
  return this.cache.get(key)!;
}
const compiled = await this.doCompile(language, source);
this.cache.set(key, compiled);   // LRU 自动淘汰旧条目
return compiled;
```

默认容量 100，同一 bot 代码无论打多少局都只编译一次。

### 3.5 SSRF 防护

评测引擎需要向用户提供的 callback URL 发 HTTP 请求，如果不做防护等于提供了内网探测工具。

拦截覆盖所有常见绕过姿势：

```typescript
// 内网 CIDR 块
const PRIVATE_RANGES = [
  '127.0.0.0/8', '10.0.0.0/8',
  '172.16.0.0/12', '192.168.0.0/16',
  '::1', 'fc00::/7', 'fe80::/10',
  '169.254.0.0/16',  // link-local
];

// 拦截绕过：
// - IPv6 hex bypass:   http://0x7f000001/
// - URL-encoded:       http://%31%32%37.0.0.1/
// - Buffer overflow:   超长 hostname（>253 字节）
// - Decimal encoding:  http://2130706433/（127.0.0.1 的十进制）
```

全部有对应单元测试。

### 3.6 Bull 异步队列

```
POST /v1/judge  →  Bull.add()  →  return { jobId }
                        │
               ┌────────▼────────┐
               │   Worker Pool    │  (JUDGE_CONCURRENCY 并发)
               │  processTask()  │
               └────────┬────────┘
                        │ job.returnvalue = result
                        ▼
GET /v1/judge/:id/status  →  Bull.getJob()  →  { state, result }
```

结果写入 `job.returnvalue`（Redis 持久化），客户端轮询 status 接口即可拿到完整评测结果。

### 3.7 可观测性

```
# Prometheus metrics
botzone_judge_requests_total{type="oj",verdict="AC"} 42
botzone_judge_duration_ms_bucket{type="botzone",le="500"} 38
botzone_compile_cache_hits_total 156

# pino 结构化日志（JSON）
{
  "time": "2026-03-10T02:51:18.877Z",
  "trace_id": "b19cdbe6bbf99a02",
  "context": "RunOJUseCase",
  "msg": "OJ 评测完成: verdict=WA, testcases=3"
}
```

每个 HTTP 请求有 `X-Request-ID`，贯穿日志 + callback 请求头，链路完全可追踪。

---

## 四、Leverage 后端集成

### 4.1 JudgeProvider 抽象

Leverage 后端不直接依赖 botzone-neo，而是通过接口解耦：

```typescript
export interface IJudgeProvider {
  enqueue(params: EnqueueParams): Promise<EnqueueResult>;
  poll(submissionId: number, externalJobId: string): Promise<PollResult>;
  mapCallback(body: unknown): PollResult;
}
```

`BotzoneJudgeProvider` 是这个接口的实现，通过 HTTP 调用 botzone-neo。将来要接入其他评测平台只需实现同一接口。

### 4.2 数据库模型扩展（仅追加）

对 `Submission` 表追加三个 nullable 列：

```sql
ALTER TABLE submission ADD COLUMN provider VARCHAR(32) NULL;
ALTER TABLE submission ADD COLUMN externalJobId VARCHAR(128) NULL;
ALTER TABLE submission ADD COLUMN providerMeta TEXT NULL;
CREATE INDEX idx_submission_provider ON submission(provider);
```

`providerMeta` 存 JSON，对于 Botzone 对战，里面包含 `gameLog`（每个回合的数据），供前端回放用。

### 4.3 回调安全

```
botzone-neo  ──POST /botzone/callback──▶  leverage-backend
              Authorization: Bearer <BOTZONE_CALLBACK_TOKEN>
              X-Botzone-JobId: 42
```

回调处理三重保障：
1. **Token 验证**：Bearer token 校验，无 token 直接 401
2. **幂等性**：相同 `jobId + state` 组合只处理一次，重复 callback 直接 200 返回
3. **补偿轮询**：每 30s 对所有 pending 提交扫一遍，防止 callback 丢失

### 4.4 状态映射

```typescript
// botzone-neo state → leverage submission status
export const BOTZONE_STATE_TO_LEVERAGE: Record<BotzoneJobState, number> = {
  pending:    STATUS.JUDGING,
  queued:     STATUS.JUDGING,
  compiling:  STATUS.JUDGING,
  running:    STATUS.JUDGING,
  finished:   -1,   // 由 verdict 决定
  failed:     STATUS.SYSTEM_ERROR,
};

// botzone-neo verdict → leverage status
export const BOTZONE_VERDICT_TO_LEVERAGE: Record<BotzoneVerdict, number> = {
  Accepted:            STATUS.ACCEPTED,
  WrongAnswer:         STATUS.WRONG_ANSWER,
  TimeLimitExceeded:   STATUS.TIME_LIMIT_EXCEEDED,
  RuntimeError:        STATUS.RUNTIME_ERROR,
  CompileError:        STATUS.COMPILE_ERROR,
  SystemError:         STATUS.SYSTEM_ERROR,
};
```

### 4.5 测试数量增长

| 阶段 | 测试数 |
|------|--------|
| 原始后端 | 596 |
| Task 1 集成 | 651 (+55) |
| Task 2 结果映射修复 | 675 (+24) |

---

## 五、Leverage 前端集成

### 5.1 提交详情页

更新后的 `/submissions/:id` 支持：

- **实时轮询**：status = pending/judging 时每 3s 拉一次，到达终态后停止
- **OJ 结果面板**：编译结果 + 逐测试点表格（verdict badge、时间、内存、实际输出展开）
- **Botzone 回放面板**：`provider === 'botzone'` 时自动渲染

### 5.2 Game Renderer 插件系统

```typescript
// renderers/index.ts — 插件注册表
const rendererRegistry = new Map<string, () => Promise<Component>>();

export function registerRenderer(gameId: string, loader: () => Promise<Component>) {
  rendererRegistry.set(gameId, loader);
}

// 内置注册
registerRenderer('tictactoe', () => import('./TicTacToe.vue'));
```

```vue
<!-- GameRenderer.vue — 根渲染器 -->
<script setup lang="ts">
const { gameLog, currentRound } = defineProps<{
  gameLog: BotzoneGameLog
  currentRound: number
}>()

const renderer = ref<Component | null>(null)

watchEffect(async () => {
  const loader = rendererRegistry.get(gameLog.gameId)
  renderer.value = loader ? await loader() : GenericRenderer
})
</script>

<template>
  <component :is="renderer" :game-log="gameLog" :current-round="currentRound" />
</template>
```

`GenericRenderer` 是默认 fallback，用折叠面板展示原始 JSON 数据。`TicTacToe.vue` 是第一个 game-specific renderer，渲染 3×3 棋盘并展示到当前回合的棋局状态。

### 5.3 ReplayViewer 组件

```
┌────────────── Botzone Game Replay ──────────────┐
│  Game: tictactoe   Verdict: Player 0 Wins       │
│  Scores: { "0": 1, "1": 0 }                     │
├─────────────────────────────────────────────────┤
│  Round 2 / 5   [|◀] [◀] [▶] [▶|] [⏯ Auto]     │
├─────────────────────────────────────────────────┤
│                                                   │
│  [TicTacToe.vue or GenericRenderer.vue here]    │
│                                                   │
│  ▼ Bot 0 Output    ▼ Bot 1 Output               │
│  {"move": [0,0]}   {"move": [1,1]}              │
└─────────────────────────────────────────────────┘
```

---

## 六、水平扩展设计

### 6.1 为什么 botzone-neo 容易扩展

Worker 无状态：
- 任务数据存在 Redis（Bull queue）
- 结果存在 Redis（`job.returnvalue`）
- Worker 本身只读/写 Redis，不维护任何进程内状态（除编译 LRU 缓存，这是 worker-local 的，可重建）

加一台机器只需：

```bash
# Server 2
git clone https://github.com/bkmashiro/botzone-neo
cd botzone-neo
cp deploy/.env.worker.example .env
# 编辑 .env: REDIS_HOST=<server1-ip>, REDIS_PASSWORD=...
docker compose -f deploy/docker-compose.worker.yml up -d
```

### 6.2 并发调优

```bash
# JUDGE_CONCURRENCY = CPU 核数 × 2~4（推荐）
# 过高：nsjail 内存压力大，反而降低吞吐
# 过低：CPU 利用率不足
JUDGE_CONCURRENCY=16  # 4 核机器推荐值
```

### 6.3 Redis 网络隔离

多台机器共享 Redis，暴露端口要做保护：

```yaml
# Server 1 redis 配置
bind: 0.0.0.0          # 或绑定到 Tailscale IP
requirepass: <strong-password>
```

推荐用 Tailscale 组网，Worker 机器只通过 Tailscale 网络访问 Redis，不暴露到公网。

---

## 七、踩的坑

### Bull 并发数是 float

`configService.get<number>('JUDGE_CONCURRENCY', 15)` 在 NestJS 里返回的是字符串（env var 都是字符串），Bull 内部直接用这个值设并发数，不做 parseInt，报错"Cannot set Float as concurrency"。

```typescript
// 错的
const concurrency = this.configService.get<number>('JUDGE_CONCURRENCY', 15);

// 对的
const concurrency = parseInt(this.configService.get<string>('JUDGE_CONCURRENCY', '15'), 10);
```

### job.returnvalue 需要显式 return

Bull 把 processor 函数的返回值存为 `job.returnvalue`，这个值才能在 status 接口里返回给客户端。如果 processor 是 `Promise<void>` 类型，`return;` 退出时 `returnvalue` 是 `undefined`，前端拿不到结果。

```typescript
// 错的
private async processTask(job): Promise<void> {
  await this.runOJUseCase.execute(task);
}

// 对的
private async processTask(job): Promise<unknown> {
  const result = await this.runOJUseCase.execute(task);
  return result;   // 存入 job.returnvalue
}
```

### 临时目录竞争

并发评测时，每个 testcase 必须用独立的工作目录，否则不同评测的进程会争抢文件：

```typescript
// 每个测试用例独立子目录
const tcWorkDir = path.join(workDir, `tc-${tc.id}`);
await fs.mkdir(tcWorkDir, { recursive: true });
// 评测结束后统一清理父目录
await fs.rm(workDir, { recursive: true, force: true });
```

---

## 八、最终成果

| 指标 | 数值 |
|------|------|
| botzone-neo commits | 145 |
| botzone-neo 测试数 | 319 |
| botzone-neo 覆盖率 | 92.93% |
| leverage-backend 测试数 | 675 |
| 新增前端页面/组件 | 8个 |
| 支持语言 | C++ / Python / TypeScript |
| 评测模式 | OJ / Botzone 对战 |
| Botzone 交互策略 | restart / standard / checker / longrun |
| 安全特性 | SSRF / 限流 / 输入验证 / HMAC callback |
| 可观测性 | Prometheus + pino + Request ID 链路追踪 |
| 扩展方式 | Worker 无状态，加机器即扩容 |

### 仓库

- 评测引擎：[github.com/bkmashiro/botzone-neo](https://github.com/bkmashiro/botzone-neo)
- 后端：[github.com/ThinkSpiritLab/leverage-backend-neo](https://github.com/ThinkSpiritLab/leverage-backend-neo)
- 前端：[github.com/ThinkSpiritLab/leverage-frontend-neo](https://github.com/ThinkSpiritLab/leverage-frontend-neo)

---

## 九、后续计划

1. **sandlock 替换 nsjail**：sandlock 是我们自研的轻量级沙箱（rlimit + seccomp），比 nsjail 安装和配置更简单，已完成 v1.5.0，计划作为 botzone-neo 的默认生产沙箱
2. **WASM 沙箱**：WebAssembly 运行时作为 sandlock 的 fallback，支持无 Linux 内核能力的环境（比如部分 VPS 的 seccomp 受限场景）
3. **Botzone ELO 排名**：对战结果接入 ELO 算法，实现实时排行榜
4. **Game Renderer 生态**：为每个游戏写专属可视化渲染器，像插件一样安装
5. **实时对战视角**：从"赛后回放"升级到 SSE/WebSocket 流式推送，支持实时观看对战过程

---

*这是一个多 AI Agent 协作工程实践的产物。评测引擎核心用 6 个 Claude 子 Agent 并行完成，leverage 集成用 5 个子 Agent 线性/并行混合完成，总计不到一天，比传统工程效率高出数倍。这种工作模式值得更多探索。*
