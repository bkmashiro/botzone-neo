# Botzone Neo — Technical Report

**Date:** 2026-03-10  
**Version:** 1.0.0  
**Commits since init:** 145  
**Test coverage:** 92.93% statements, 319 tests across 27 suites

---

## Overview

Botzone Neo is a production-grade code judge engine supporting both competitive game judging (Botzone-style) and standard OJ (Online Judge) evaluation. Built as a ground-up NestJS rewrite with strict TypeScript, Domain-Driven Design, and comprehensive observability.

---

## Architecture

### Domain-Driven Design Layers

```
src/
├── domain/           # Pure business logic, no framework dependencies
│   ├── verdict.ts    # AC/WA/TLE/RE/CE/SE verdict types
│   ├── oj/           # OJ task, testcase, result, checker interface
│   └── botzone/      # Match task, round, bot I/O types
│
├── infrastructure/   # Framework adapters (NestJS DI)
│   ├── compile/      # CompileService: LRU cache, multi-language
│   ├── sandbox/      # ISandbox interface + DirectSandbox/NsjailSandbox
│   └── callback/     # CallbackService: retry, timeout, X-Request-ID
│
├── strategies/       # Pluggable algorithm implementations
│   ├── botzone/      # RestartStrategy, StandardStrategy, CheckerStrategy, LongrunStrategy
│   └── oj/           # DiffChecker, CustomChecker (Codeforces format)
│
├── application/      # Use cases (orchestrate domain + infrastructure)
│   ├── run-match.usecase.ts
│   └── run-oj.usecase.ts
│
└── interface/        # HTTP controllers, DTOs, Bull queue service
    ├── judge.controller.ts
    ├── judge-queue.service.ts
    └── dto/
```

### Key Design Decisions

**ISandbox abstraction:** The sandbox is injected via NestJS DI (`SANDBOX_TOKEN`). In development, `DirectSandbox` runs processes natively. In production (Linux), `NsjailSandbox` wraps execution in nsjail with resource limits. Swapping sandboxes requires zero business logic changes.

**IJob composition:** Bot processes are modeled as composable `IJob` objects (compile → run → parse output → callback). The strategy pattern (`RestartStrategy`, `StandardStrategy`, `CheckerStrategy`, `LongrunStrategy`) determines the interaction protocol.

**CompileService LRU cache:** Compiled binaries are cached by (language, source hash) with LRU eviction. Cache size defaults to 100 entries. This eliminates redundant compilation across multiple game rounds.

**Bull queue with Redis:** All judge tasks are enqueued via Bull, providing durability, retry semantics, and the `/v1/judge/:jobId/status` polling API. Job results are stored in Redis via `job.returnvalue`.

---

## API Reference

### POST /v1/judge

Submit a judge task. Returns `{ jobId }` immediately (async).

**Botzone task:**
```json
{
  "type": "botzone",
  "game": {
    "judger": { "language": "python", "source": "...", "limit": { "time": 2000, "memory": 256 } },
    "0": { "language": "cpp", "source": "...", "limit": { "time": 1000, "memory": 256 } },
    "1": { "language": "python", "source": "...", "limit": { "time": 1000, "memory": 256 } }
  },
  "callback": {
    "update": "https://your-server/update",
    "finish": "https://your-server/finish"
  }
}
```

**OJ task:**
```json
{
  "type": "oj",
  "language": "python",
  "source": "...",
  "timeLimitMs": 1000,
  "memoryLimitMb": 256,
  "testcases": [
    { "id": 1, "input": "1 2", "expectedOutput": "3" }
  ],
  "judgeMode": "standard",
  "callback": {
    "update": "https://your-server/update",
    "finish": "https://your-server/finish"
  }
}
```

### GET /v1/judge/:jobId/status

Poll job state. Returns full result when completed:

```json
{
  "jobId": "42",
  "state": "completed",
  "type": "oj",
  "finishedOn": "2026-03-10T02:51:18.877Z",
  "result": {
    "verdict": "AC",
    "testcases": [
      { "id": 1, "verdict": "AC", "actualOutput": "3\n", "timeMs": 13 }
    ],
    "compile": { "verdict": "OK" }
  }
}
```

### GET /health

```json
{ "status": "ok", "version": "1.0.0", "uptime": 120, "components": { "redis": { "status": "ok" }, "disk": { "status": "ok" } } }
```

### GET /metrics

Prometheus metrics endpoint:
- `botzone_judge_requests_total{type, verdict}` — counter
- `botzone_judge_duration_ms{type}` — histogram
- `botzone_compile_cache_hits_total` — LRU cache hit rate
- Standard Node.js + process metrics

---

## Supported Languages

| Language   | Compiler/Runtime      | Extension |
|------------|-----------------------|-----------|
| C++        | g++ -O2 -std=c++17    | .cpp      |
| Python     | python3               | .py       |
| TypeScript | ts-node               | .ts       |

---

## Security

### SSRF Protection

All callback URLs are validated against a blocklist of private/reserved IP ranges:
- `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `::1`, `fc00::/7`, `fe80::/10`, `169.254.0.0/16`
- Buffer overflow patterns (extremely long hostnames)
- IPv6 hex-encoded bypass attempts

### Input Validation

- Source code: max 64KB per participant
- Testcase input/output: max 10MB each, 100MB total
- Bot output per round: max 256KB
- Global data: max 64KB, configurable TTL cleanup
- Stdout truncation at configurable limit

### Rate Limiting

60 requests/minute per IP via `@nestjs/throttler`. Configurable via `THROTTLE_LIMIT` / `THROTTLE_TTL`.

### Docker Hardening

- Non-root user (`judger:judger`, UID 1001)
- Read-only filesystem with explicit tmpfs mounts
- nsjail pinned to tag `3.4`, wasmtime pinned to `v29.0.1`
- Resource limits in docker-compose (`cpus: 4`, `memory: 4g`)
- Health checks with 30s interval

---

## Botzone Protocol

The judger program communicates with bots via stdin/stdout JSON:

**Judger → Bots (request round):**
```json
{ "command": "request", "content": { "0": <data-for-bot-0> }, "display": "optional-display" }
```

**Bots → Judger (after each round):**
```json
{ "response": <bot-output> }
```

**Judger → Engine (finish):**
```json
{ "command": "finish", "content": { "0": 1, "1": 0 }, "display": "final-board" }
```

**Interaction modes:**
- `restart`: Bot process restarted each round (stateless)
- `standard`: Bot process persists, receives full game log each round
- `checker`: Custom checker with Codeforces exit-code format (0=OK, 1=WA, 2=PE, 3=fail)
- `longrun`: Bot uses SIGSTOP/SIGCONT for zero-restart persistent state

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | HTTP listen port |
| `REDIS_HOST` | redis | Redis hostname |
| `REDIS_PORT` | 6379 | Redis port |
| `JUDGE_CAPABILITY` | 15 | Max concurrent matches |
| `JUDGE_CONCURRENCY` | 15 | Bull queue worker concurrency |
| `COMPILE_TIME_LIMIT_MS` | 10000 | Compilation timeout |
| `COMPILE_MEMORY_LIMIT_MB` | 512 | Compilation memory |
| `MAX_MATCH_DURATION_MS` | 300000 | Max game duration (5 min) |
| `CALLBACK_TIMEOUT_MS` | 5000 | Callback HTTP timeout |
| `CALLBACK_RETRY_COUNT` | 3 | Callback retry attempts |
| `NODE_ENV` | development | `production` disables Swagger |

---

## Test Coverage

```
Test Suites: 27 passed, 27 total
Tests:       319 passed, 319 total
Statement coverage: 92.93%
Branch coverage:    87.4%
Function coverage:  93.1%
```

Coverage breakdown by module:
- Domain: 97%+
- Infrastructure: 91%+
- Strategies: 94%+
- Application use cases: 89%+
- Interface (controllers/queue): 88%+

---

## Running Locally

```bash
# Prerequisites
docker run -d --name botzone-redis -p 6379:6379 redis:7-alpine

# Install & build
pnpm install
pnpm build

# Configure
cp .env.example .env
# Edit: REDIS_HOST=localhost, SANDBOX_BACKEND=direct (Mac/dev)

# Run
NODE_ENV=development node dist/src/main.js

# Test
curl http://localhost:3001/health
```

---

## Production Deployment

```bash
# Build image
docker build -t botzone-neo .

# Run with docker-compose
docker-compose up -d

# Check health
docker-compose exec botzone curl http://localhost:3001/health
```

For production, ensure:
- `NODE_ENV=production` (disables Swagger)
- Network-level IP restrictions (firewall / reverse proxy)
- `SANDBOX_BACKEND=nsjail` (Linux only, requires nsjail installed)
- Redis persistence configured
- Resource limits reviewed in `docker-compose.yml`
