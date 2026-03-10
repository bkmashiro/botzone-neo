/**
 * AppModule — 应用根模块（新架构）
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JudgeModule } from './judge.module';

@Module({
  imports: [
    // 全局配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),

    // 评测模块
    JudgeModule,
  ],
})
export class AppModule {}
