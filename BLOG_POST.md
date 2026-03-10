# 从零构建一个生产级代码评测引擎：Botzone Neo 技术复盘

> 用一夜时间，多 Agent 协作完成了一个从零到 145 commits、319 个测试、92.93% 覆盖率的评测引擎。这篇文章记录整个过程和技术决策。

---

## 背景

我们需要一个评测引擎，能同时支持两种场景：

1. **Botzone 对战**：两个 AI bot 程序互相对弈，裁判程序协调通信，最终给出胜负
2. **OJ 评测**：标准 Online Judge 模式，给定输入跑代码，比对输出，判定 AC/WA/TLE/RE

原来的实现是一个年久失修的 Node.js 脚本堆。这次目标是：**生产可用、测试完善、架构清晰**。

---

## 架构选型

### 为什么选 NestJS

NestJS 的模块化 DI 系统非常适合做评测引擎这种"多个可替换组件"的场景：沙箱可以换（nsjail/direct），Checker 可以换（diff/custom），评测策略可以换（restart/standard/longrun）。把这些都做成接口 + DI 注入，测试时 mock 掉，逻辑不用改。

### DDD 分层

```
domain → infrastructure → strategies → application → interface
```

这不是为了架构而架构。核心原因：**domain 层完全不依赖 NestJS**，纯 TypeScript 对象，测试极快，没有任何 I/O。

```typescript
// domain/verdict.ts — 纯枚举，零依赖
export enum Verdict {
  AC = 'AC', WA = 'WA', TLE = 'TLE',
  RE = 'RE', CE = 'CE', SE = 'SE', OK = 'OK'
}
```

业务逻辑在 domain 里写清楚，infrastructure 只做 I/O 适配，不混在一起。

---

## 核心设计：ISandbox 抽象

这是整个引擎最关键的抽象：

```typescript
export interface ISandbox {
  execute(opts: SandboxExecuteOptions): Promise<SandboxResult>;
}
```

`DirectSandbox`（开发环境）：直接 `child_process.spawn`，不做任何隔离。  
`NsjailSandbox`（生产 Linux）：通过 nsjail 包裹进程，cgroups + seccomp + chroot。

切换只需要改一个环境变量 `SANDBOX_BACKEND=nsjail|direct`，业务代码零改动。

---

## Botzone 协议实现

Botzone 的通信协议设计得很巧妙：裁判程序和 bot 程序之间通过 stdin/stdout 传 JSON，引擎负责管道调度。

```
Engine → Judger stdin: 当前游戏日志 JSON
Judger stdout → Engine: { "command": "request", "content": {...} }
Engine → Bot-0 stdin: content["0"]
Bot-0 stdout → Engine: { "response": "move" }
Engine → Judger stdin: 更新后的游戏日志
...
Engine → Judger stdin: { "command": "finish", "content": { "0": 1, "1": 0 } }
```

四种交互模式：

- **restart**：每轮重启 bot 进程，最简单，适合无状态 bot
- **standard**：bot 进程持久运行，每轮收到完整日志
- **checker**：用 Codeforces checker 格式（exit code 0/1/2/3）判定结果
- **longrun**：SIGSTOP/SIGCONT 挂起/恢复，零重启开销，适合需要初始化的 bot

---

## 编译缓存

评测引擎最耗时的操作是编译。对于 Botzone 多局对战，如果每局都重新编译，体验很差。

解决方案：LRU 缓存，key 是 `(language, sha256(source))`，value 是编译产物（临时目录）。

```typescript
// CompileService 核心逻辑
const key = `${language}:${sha256(source)}`;
if (this.cache.has(key)) {
  this.cacheHits.inc();
  return this.cache.get(key)!;
}
const compiled = await this.doCompile(language, source);
this.cache.set(key, compiled);  // LRU 自动淘汰
return compiled;
```

默认缓存 100 个条目。实际场景下，同一个 bot 代码打多局，只编译一次。

---

## SSRF 防护

评测引擎需要向用户提供的 callback URL 发 HTTP 请求，这里必须做 SSRF 防护，否则可以用来探测内网。

拦截的场景（全部经过测试）：

```typescript
// 内网 IP 段
const PRIVATE_RANGES = [
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '::1', 'fc00::/7', 'fe80::/10', '169.254.0.0/16'
];

// 绕过姿势也要拦
// Buffer overflow: 超长 hostname
// IPv6 hex bypass: http://0x7f000001/
// URL encoded bypass: http://%31%32%37%2e%30%2e%30%2e%31/
```

---

## 异步架构：Bull + Redis

所有评测任务走 Bull 队列，原因：

1. **持久化**：重启不丢任务
2. **并发控制**：`JUDGE_CONCURRENCY` 控制同时跑多少个评测
3. **结果查询**：`/v1/judge/:jobId/status` 轮询，结果存在 `job.returnvalue`（Redis）
4. **未来扩展**：Bull Board UI、优先级队列、延迟任务

```
POST /v1/judge → Bull enqueue → return { jobId }
GET  /v1/judge/:jobId/status → Bull.getJob → { state, result }
```

---

## 可观测性

**Prometheus metrics** (`/metrics`)：

```
botzone_judge_requests_total{type="oj",verdict="AC"} 42
botzone_judge_duration_ms_bucket{type="botzone",le="1000"} 38
botzone_compile_cache_hits_total 156
```

**结构化日志**（pino，JSON 格式）：

```json
{
  "level": "info",
  "time": "2026-03-10T02:51:18.877Z",
  "trace_id": "b19cdbe6bbf99a02",
  "span_id": "49dcc9a20b34cc6f",
  "context": "RunOJUseCase",
  "msg": "OJ 评测完成: verdict=WA, testcases=3"
}
```

每个请求有 `X-Request-ID`，贯穿日志 + callback header，方便链路追踪。

---

## 测试策略

**319 个测试，92.93% 覆盖率**，做到这个数字的关键不是"为了覆盖率而写测试"，而是分层测试：

- **Domain 层**：纯单元测试，无 mock，直接实例化，跑几毫秒
- **Infrastructure 层**：集成测试，mock sandbox/HTTP，验证重试/超时逻辑
- **Strategy 层**：用 `DirectSandbox` 真实运行 Python/C++ 代码，验证协议正确性
- **Use case 层**：mock 所有 infrastructure，验证业务流程
- **Controller 层**：`@nestjs/testing` 启动完整模块，发 HTTP 请求，验证 DTO 验证/错误响应

覆盖率不追求 100%，但每个关键路径（CE/TLE/WA/RE/SSRF/cache hit）都有对应测试。

---

## 踩的坑

**Bull 并发数必须是整数**：`configService.get<number>('JUDGE_CONCURRENCY', 15)` 返回的是字符串，Bull 内部 `parseInt` 没做，直接用 float 报错。修复：显式 `parseInt(..., 10)`。

**多进程竞争临时目录**：每个测试用例用 `fs.mkdtemp` 创建独立工作目录，但并发时旧目录可能没清理完就被下一个任务用到。解决：给每个 testcase 独立子目录 `tc-${id}/`，清理时 `rm -rf` 整个 workDir。

**`job.returnvalue` 需要 return**：Bull 把 `processTask` 的返回值存为 `returnvalue`。如果函数签名是 `Promise<void>` 且 `return;` 退出，`returnvalue` 是 undefined。改成 `Promise<unknown>` 并 `return result` 即可。

---

## 最终成果

| 指标 | 数值 |
|------|------|
| 总 commits | 145 |
| 测试数量 | 319 |
| 语句覆盖率 | 92.93% |
| 支持语言 | C++ / Python / TypeScript |
| 评测模式 | Botzone / OJ |
| 交互策略 | restart / standard / checker / longrun |
| 安全特性 | SSRF / 限流 / 输入验证 / 资源限制 |
| 可观测性 | Prometheus + pino 结构化日志 + Request ID |

代码：[github.com/bkmashiro/botzone-neo](https://github.com/bkmashiro/botzone-neo)

---

*这个项目用多 AI Agent 协作完成，从零到可用花了不到一天。架构图、API 设计、测试策略都是人机协作的产物。欢迎 star 或提 issue。*
