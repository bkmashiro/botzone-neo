/**
 * 应用入口（新架构）
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.enableShutdownHooks();

  // 安全 HTTP 头
  app.use(helmet());

  // CORS（仅允许配置的来源）
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', '*'),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Request-ID'],
  });

  // 请求体大小限制（1MB）
  app.use(json({ limit: '1mb' }));

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger 文档（仅非生产环境）
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Botzone Neo Judge API')
      .setDescription('Botzone 评测服务 API 文档')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document);
    logger.log('Swagger 文档已启用: /api');
  }

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`Botzone Judger 已启动，监听端口 ${port}`);
}

bootstrap();
