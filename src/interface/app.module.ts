/**
 * AppModule — 应用根模块（新架构）
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { JudgeModule } from './judge.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // 全局配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
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

    // Prometheus /metrics 端点
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),

    // 评测模块
    JudgeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
