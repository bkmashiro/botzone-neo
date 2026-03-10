/**
 * 性能基准测试
 *
 * 测量关键路径的耗时：
 * - CompileService 缓存命中 vs 未命中
 * - RestartStrategy 单轮执行（Mock 沙箱）
 * - DiffChecker 大输出（1MB）比对
 */

/* eslint-disable no-console */
import { ConfigService } from '@nestjs/config';
import { Counter } from 'prom-client';
import { CompileService } from '../../src/infrastructure/compile/compile.service';
import { RestartStrategy } from '../../src/strategies/botzone/restart.strategy';
import { DiffChecker } from '../../src/strategies/oj/diff.checker';
import { ISandbox, SandboxResult } from '../../src/infrastructure/sandbox/sandbox.interface';
import { BotRuntime, BotInput } from '../../src/domain/bot';

// ── Helpers ──

function timeMs(fn: () => unknown | Promise<unknown>): Promise<number> {
  return (async () => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  })();
}

function repeat(s: string, targetBytes: number): string {
  const times = Math.ceil(targetBytes / Buffer.byteLength(s));
  return (s + '\n').repeat(times);
}

// ── CompileService 缓存基准 ──

describe('benchmark: CompileService cache', () => {
  let service: CompileService;

  beforeAll(() => {
    const configService = {
      get: (key: string, defaultVal?: unknown) => {
        if (key === 'COMPILE_TIME_LIMIT_MS') return 10000;
        return defaultVal;
      },
    } as ConfigService;
    const mockCounter = { inc: (): void => {} } as unknown as Counter;
    service = new CompileService(configService, mockCounter, mockCounter);
  });

  it('cache miss vs cache hit latency', async () => {
    // python compile 只做 py_compile 检查，实际可用且速度快
    const source = 'print("hello benchmark")';
    const language = 'python';

    // 第一次：cache miss（实际编译）
    const missTimes: number[] = [];
    for (let i = 0; i < 3; i++) {
      // 改变 source 强制 cache miss
      const uniqueSource = `${source}  # run ${i} ${Date.now()}`;
      const t = await timeMs(() => service.compile(language, uniqueSource));
      missTimes.push(t);
    }

    // cache hit（重复编译相同源码）
    const fixedSource = `${source}  # fixed ${Date.now()}`;
    await service.compile(language, fixedSource); // warm up
    const hitTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = await timeMs(() => service.compile(language, fixedSource));
      hitTimes.push(t);
    }

    const avgMiss = missTimes.reduce((a, b) => a + b, 0) / missTimes.length;
    const avgHit = hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length;

    console.log(`[CompileService] cache miss avg: ${avgMiss.toFixed(2)}ms (n=${missTimes.length})`);
    console.log(`[CompileService] cache hit avg:  ${avgHit.toFixed(4)}ms (n=${hitTimes.length})`);
    console.log(`[CompileService] speedup:        ${(avgMiss / avgHit).toFixed(0)}x`);

    // 缓存命中应该 < 1ms，远快于实际编译
    expect(avgHit).toBeLessThan(1);
    // 缓存命中应比未命中快至少 10 倍
    expect(avgMiss / avgHit).toBeGreaterThan(10);
  }, 30000);
});

// ── RestartStrategy 单轮基准 ──

describe('benchmark: RestartStrategy round', () => {
  it('single round latency with mock sandbox', async () => {
    const mockResult: SandboxResult = {
      stdout: JSON.stringify({ response: 'move_a1', debug: 'ok' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    };

    const mockSandbox: ISandbox = {
      execute: () => Promise.resolve(mockResult),
    };

    const strategy = new RestartStrategy(mockSandbox);

    const bot: BotRuntime = {
      id: '0',
      compiled: { cmd: 'echo', args: [], language: 'cpp', readonlyMounts: [] },
      workDir: '/tmp/bench',
      limit: { timeMs: 1000, memoryMb: 256 },
    };

    const input: BotInput = {
      requests: ['init'],
      responses: [],
      data: '',
      globaldata: '',
      time_limit: 1,
      memory_limit: 256,
    };

    // 预热
    for (let i = 0; i < 10; i++) {
      await strategy.runRound(bot, input);
    }

    // 正式测量
    const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t = await timeMs(() => strategy.runRound(bot, input));
      times.push(t);
    }

    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p50 = times[Math.floor(times.length * 0.5)];
    const p99 = times[Math.floor(times.length * 0.99)];

    console.log(
      `[RestartStrategy] avg: ${avg.toFixed(4)}ms, p50: ${p50.toFixed(4)}ms, p99: ${p99.toFixed(4)}ms (n=${times.length})`,
    );

    // mock sandbox 下，单轮应该 < 1ms
    expect(avg).toBeLessThan(1);
  });

  it('output parsing performance (JSON vs simplified)', () => {
    const strategy = new RestartStrategy({ execute: () => Promise.resolve({} as SandboxResult) });

    const jsonOutput = JSON.stringify({ response: 'a1', debug: 'ok', data: 'x', globaldata: 'y' });
    const simplifiedOutput = 'a1\nsession_data\nglobal_data';

    // JSON parse benchmark
    const jsonTimes: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const start = performance.now();
      strategy.parseOutput(jsonOutput);
      jsonTimes.push(performance.now() - start);
    }

    // Simplified parse benchmark
    const simpleTimes: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const start = performance.now();
      strategy.parseOutput(simplifiedOutput);
      simpleTimes.push(performance.now() - start);
    }

    const avgJson = jsonTimes.reduce((a, b) => a + b, 0) / jsonTimes.length;
    const avgSimple = simpleTimes.reduce((a, b) => a + b, 0) / simpleTimes.length;

    console.log(
      `[RestartStrategy] JSON parse avg:       ${avgJson.toFixed(4)}ms (n=${jsonTimes.length})`,
    );
    console.log(
      `[RestartStrategy] Simplified parse avg: ${avgSimple.toFixed(4)}ms (n=${simpleTimes.length})`,
    );

    // 两种模式都应在微秒级
    expect(avgJson).toBeLessThan(0.1);
    expect(avgSimple).toBeLessThan(0.1);
  });
});

// ── DiffChecker 大输出基准 ──

describe('benchmark: DiffChecker large output', () => {
  const checker = new DiffChecker();

  it('1MB identical output diff', async () => {
    // 生成 ~1MB 的输出（约 20000 行，每行 50 字符）
    const line = 'abcdefghij klmnopqrst uvwxyz 0123456789 ABCDEF';
    const output = repeat(line, 1024 * 1024);
    const lineCount = output.split('\n').length;

    console.log(
      `[DiffChecker] output size: ${(Buffer.byteLength(output) / 1024).toFixed(0)}KB, lines: ${lineCount}`,
    );

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = await timeMs(() => checker.check('', output, output));
      times.push(t);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(
      `[DiffChecker] 1MB identical: avg ${avg.toFixed(2)}ms, max ${max.toFixed(2)}ms (n=${times.length})`,
    );

    // 1MB diff 应该 < 100ms
    expect(avg).toBeLessThan(100);
  });

  it('1MB output with diff at end', async () => {
    const line = 'abcdefghij klmnopqrst uvwxyz 0123456789 ABCDEF';
    const expected = repeat(line, 1024 * 1024);
    const lines = expected.split('\n');
    // 修改最后一行
    lines[lines.length - 2] = 'DIFFERENT LINE';
    const actual = lines.join('\n');

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = await timeMs(() => checker.check('', expected, actual));
      times.push(t);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`[DiffChecker] 1MB diff-at-end: avg ${avg.toFixed(2)}ms (n=${times.length})`);

    // 最坏情况也应 < 200ms
    expect(avg).toBeLessThan(200);
  });

  it('1MB output line count mismatch', async () => {
    const line = 'abcdefghij klmnopqrst uvwxyz 0123456789 ABCDEF';
    const expected = repeat(line, 1024 * 1024);
    const actual = expected + '\nextra line';

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = await timeMs(() => checker.check('', expected, actual));
      times.push(t);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(
      `[DiffChecker] 1MB line-count-mismatch: avg ${avg.toFixed(2)}ms (n=${times.length})`,
    );

    // 行数不匹配时应该提前退出，更快
    expect(avg).toBeLessThan(100);
  });
});
