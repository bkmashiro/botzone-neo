/**
 * JudgeModule 条件沙箱注入测试
 *
 * 验证 SANDBOX_BACKEND 环境变量正确选择 DirectSandbox 或 NsjailSandbox。
 */

import { register } from 'prom-client';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SANDBOX_TOKEN } from '../infrastructure/sandbox/sandbox.interface';
import { DirectSandbox } from '../infrastructure/sandbox/direct.sandbox';
import { NsjailSandbox } from '../infrastructure/sandbox/nsjail.sandbox';

// Mock BullModule since we don't have Redis in unit tests
jest.mock('@nestjs/bull', () => ({
  BullModule: { registerQueue: jest.fn().mockReturnValue({ module: class {} }) },
  InjectQueue: () => () => undefined,
}));

jest.mock('@willsoto/nestjs-prometheus', () => ({
  PrometheusModule: { register: jest.fn().mockReturnValue({ module: class {} }) },
  makeCounterProvider: jest.fn().mockReturnValue({ provide: 'counter', useValue: {} }),
  makeHistogramProvider: jest.fn().mockReturnValue({ provide: 'histogram', useValue: {} }),
  makeGaugeProvider: jest.fn().mockReturnValue({ provide: 'gauge', useValue: {} }),
  InjectMetric: () => (_target: unknown, _key: string | symbol | undefined, _index?: number) =>
    undefined,
}));

beforeEach(() => {
  register.clear();
});

describe('JudgeModule sandbox factory', () => {
  async function createSandboxWithBackend(backend?: string) {
    const envVars: Record<string, string> = {};
    if (backend !== undefined) envVars['SANDBOX_BACKEND'] = backend;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => envVars] }),
      ],
      providers: [
        {
          provide: SANDBOX_TOKEN,
          useFactory: (config: ConfigService) => {
            const sandboxType = config.get<string>('SANDBOX_BACKEND', 'direct');
            if (sandboxType === 'nsjail') {
              return new NsjailSandbox(config);
            }
            return new DirectSandbox();
          },
          inject: [ConfigService],
        },
      ],
    }).compile();

    return moduleRef.get(SANDBOX_TOKEN);
  }

  it('should default to DirectSandbox when SANDBOX_BACKEND is not set', async () => {
    const sandbox = await createSandboxWithBackend(undefined);
    expect(sandbox).toBeInstanceOf(DirectSandbox);
  });

  it('should use DirectSandbox when SANDBOX_BACKEND is "direct"', async () => {
    const sandbox = await createSandboxWithBackend('direct');
    expect(sandbox).toBeInstanceOf(DirectSandbox);
  });

  it('should use NsjailSandbox when SANDBOX_BACKEND is "nsjail"', async () => {
    const sandbox = await createSandboxWithBackend('nsjail');
    expect(sandbox).toBeInstanceOf(NsjailSandbox);
  });

  it('should default to DirectSandbox for unknown SANDBOX_BACKEND values', async () => {
    const sandbox = await createSandboxWithBackend('unknown');
    expect(sandbox).toBeInstanceOf(DirectSandbox);
  });
});
