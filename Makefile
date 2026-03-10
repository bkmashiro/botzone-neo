.PHONY: dev build test lint docker-up docker-down docker-build docker-logs clean

# 开发（docker compose 热重载）
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# 本地构建
build:
	pnpm run build

# 测试
test:
	pnpm test

# 类型检查 + Lint
lint:
	pnpm run lint

# 生产 docker
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-build:
	docker compose build --no-cache

docker-logs:
	docker compose logs -f judger

# 清理
clean:
	rm -rf dist coverage
	docker compose down -v --remove-orphans 2>/dev/null || true
