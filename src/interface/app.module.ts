/**
 * AppModule — 应用根模块（新架构）
 */

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { JudgeModule } from './judge.module';
import { RequestIdMiddleware } from './request-id.middleware';

@Module({
  imports: [
    // 全局配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),

    // 结构化日志（自动关联 X-Request-ID）
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
          (req.headers['x-request-id'] as string) ?? '',
      },
    }),

    // Bull 队列（Redis）
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    // 限流：每分钟最多 60 次请求
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),

    // Prometheus /metrics 端点
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),

    // 评测模块
    JudgeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
