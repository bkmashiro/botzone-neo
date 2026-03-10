/**
 * OpenTelemetry 初始化 — 必须在其他模块之前导入
 *
 * 使用方式: 在 main.ts 最顶部 import './telemetry';
 *
 * 环境变量:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP 导出地址（默认 http://localhost:4318）
 *   OTEL_SERVICE_NAME            — 服务名称（默认 botzone-neo）
 *   OTEL_ENABLED                 — 设为 "true" 启用（默认关闭）
 */

if (process.env.OTEL_ENABLED === 'true') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'botzone-neo',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
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
}
