# Contributing to botzone-neo

感谢你对 botzone-neo 的关注！本文档说明如何参与项目贡献。

## 开发环境搭建

### 前置要求

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/<org>/botzone-neo.git
cd botzone-neo

# 启动依赖服务（Redis）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 安装依赖
pnpm install

# 启动开发服务器（热重载）
pnpm start:dev
```

### 使用 Docker 全栈启动

```bash
docker compose up -d
```

## 代码规范

- **TypeScript**：严格模式（`noUnusedLocals`、`noUnusedParameters`）
- **Lint**：`pnpm lint`（`tsc --noEmit`）
- **Commit**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### Commit 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

常用 type：
- `feat` — 新功能
- `fix` — Bug 修复
- `docs` — 文档变更
- `test` — 测试相关
- `refactor` — 重构（无功能变化）
- `perf` — 性能优化
- `chore` — 构建、CI 等杂务
- `ci` — CI 配置变更

## 分支策略

| 分支 | 用途 |
| --- | --- |
| `main` | 稳定分支，始终可部署 |
| `feat/xxx` | 新功能开发 |
| `fix/xxx` | Bug 修复 |

## PR 流程

1. **Fork** 本仓库
2. 从 `main` 创建功能分支：`git checkout -b feat/my-feature`
3. 完成开发并提交（遵循 Conventional Commits）
4. 确保测试通过：`pnpm test`
5. 推送到你的 Fork：`git push origin feat/my-feature`
6. 创建 Pull Request 到 `main` 分支
7. 等待 Code Review，根据反馈修改
8. Review 通过后由维护者合并

## 测试要求

- **新功能必须有对应测试**
- **覆盖率不允许降低**
- 运行测试：`pnpm test`
- 覆盖率报告：`pnpm test:cov`

```bash
# 运行全部测试
pnpm test

# 带覆盖率
pnpm test:cov
```

## 项目结构

```
src/
├── domain/           # 纯领域对象（Match, Bot, Verdict）
├── application/      # 用例层（RunMatch, RunOJ）
├── infrastructure/   # 基础设施（Sandbox, Compile, DataStore）
├── strategies/       # 可插拔策略（Restart, Longrun, OJ Checker）
└── interface/        # HTTP 控制器（JudgeController）
```

详见 `docs/adr/` 了解架构决策背景。

## 需要帮助？

如果有任何问题，请通过 GitHub Issues 提问。
