/**
 * Verify module classes and DTOs can be imported (covers 0% module files).
 */
import { register } from 'prom-client';

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

describe('Module imports', () => {
  it('should import AppModule (root)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./app.module');
    expect(mod.AppModule).toBeDefined();
  });

  it('should import interface/JudgeModule', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./interface/judge.module');
    expect(mod.JudgeModule).toBeDefined();
  });
});
