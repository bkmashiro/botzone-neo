/**
 * OpenTelemetry 初始化 — 必须在其他模块之前导入
 *
 * 使用方式: 在 main.ts 最顶部 import './telemetry';
 *
 * 环境变量:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP 导出地址（默认 http://localhost:4318）
 *   OTEL_SERVICE_NAME            — 服务名称（默认 botzone-neo）
 *   OTEL_TRACES_EXPORTER         — 设为 "console" 打印 span 到控制台
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'botzone-neo',
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // 关闭高噪声的 fs instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {
    // 忽略关闭错误
  });
});
