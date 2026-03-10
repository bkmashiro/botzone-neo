/**
 * RunOJUseCase — OJ 评测用例
 *
 * 编译 → 逐个测试用例运行 → 判定 → 回报结果
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Counter, Gauge, Histogram } from 'prom-client';

import { Verdict, CompileError } from '../domain/verdict';
import { OJTask, TestcaseResult, OJResult } from '../domain/oj/testcase';
import { IChecker } from '../domain/oj/checker';

import { CompileService } from '../infrastructure/compile/compile.service';
import { CallbackService } from '../infrastructure/callback/callback.service';
import { ISandbox, SANDBOX_TOKEN } from '../infrastructure/sandbox/sandbox.interface';

import { DiffChecker } from '../strategies/oj/diff.checker';
import { CustomChecker } from '../strategies/oj/custom.checker';

@Injectable()
export class RunOJUseCase {
  private readonly logger = new Logger(RunOJUseCase.name);

  constructor(
    private readonly compileService: CompileService,
    private readonly callbackService: CallbackService,
    @Inject(SANDBOX_TOKEN) private readonly sandbox: ISandbox,
    @InjectMetric('botzone_judge_requests_total') private readonly judgeRequestsTotal: Counter,
    @InjectMetric('botzone_judge_duration_ms') private readonly judgeDurationMs: Histogram,
    @InjectMetric('botzone_active_matches') private readonly activeMatches: Gauge,
  ) {}

  async execute(task: OJTask): Promise<void> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-'));

    this.activeMatches.inc();
    const startTime = Date.now();
    let verdict = Verdict.AC;

    try {
      // ── 编译用户代码 ──
      let compiled;
      try {
        compiled = await this.compileService.compile(task.language, task.source);
      } catch (err) {
        if (err instanceof CompileError) {
          verdict = Verdict.CE;
          const result: OJResult = {
            verdict: Verdict.CE,
            testcases: [],
            compile: { verdict: Verdict.CE, message: err.message },
          };
          await this.callbackService.finish(task.callback.finish, result);
          return;
        }
        throw err;
      }

      // ── 编译 checker（如有） ──
      let checker: IChecker;
      if (task.judgeMode === 'checker' && task.checkerLanguage && task.checkerSource) {
        const checkerCompiled = await this.compileService.compile(
          task.checkerLanguage,
          task.checkerSource,
        );
        const checkerWorkDir = path.join(workDir, 'checker');
        await fs.mkdir(checkerWorkDir, { recursive: true });
        checker = new CustomChecker(this.sandbox, checkerCompiled, checkerWorkDir);
      } else {
        checker = new DiffChecker();
      }

      // ── 逐个测试用例评测 ──
      const testcaseResults: TestcaseResult[] = [];
      let overallVerdict: string = Verdict.AC;

      const defaultLimit = { timeMs: task.timeLimitMs, memoryMb: task.memoryLimitMb };

      for (const tc of task.testcases) {
        const tcWorkDir = path.join(workDir, `tc-${tc.id}`);
        await fs.mkdir(tcWorkDir, { recursive: true });

        const tcLimit = {
          timeMs: tc.timeLimitMs ?? defaultLimit.timeMs,
          memoryMb: tc.memoryLimitMb ?? defaultLimit.memoryMb,
        };

        const startTime = Date.now();

        const sandboxResult = await this.sandbox.execute({
          compiled,
          workDir: tcWorkDir,
          limit: tcLimit,
          stdin: tc.input,
        });

        const timeMs = Date.now() - startTime;

        const memoryKb = sandboxResult.memoryKb;

        if (sandboxResult.timedOut) {
          testcaseResults.push({ id: tc.id, verdict: Verdict.TLE, timeMs, memoryKb });
          if (overallVerdict === Verdict.AC) overallVerdict = Verdict.TLE;
          continue;
        }

        if (sandboxResult.exitCode !== 0) {
          testcaseResults.push({
            id: tc.id,
            verdict: Verdict.RE,
            timeMs,
            memoryKb,
            message: sandboxResult.stderr || `exit code ${sandboxResult.exitCode}`,
          });
          if (overallVerdict === Verdict.AC) overallVerdict = Verdict.RE;
          continue;
        }

        const checkResult = await checker.check(tc.input, tc.expectedOutput, sandboxResult.stdout);

        testcaseResults.push({
          id: tc.id,
          verdict: checkResult.verdict,
          actualOutput: sandboxResult.stdout,
          timeMs,
          memoryKb,
          message: checkResult.message,
        });

        if (checkResult.verdict !== Verdict.AC && overallVerdict === Verdict.AC) {
          overallVerdict = checkResult.verdict;
        }
      }

      verdict = overallVerdict;
      const result: OJResult = {
        verdict: overallVerdict,
        testcases: testcaseResults,
        compile: { verdict: Verdict.OK },
      };
      await this.callbackService.finish(task.callback.finish, result);
    } finally {
      this.activeMatches.dec();
      this.judgeRequestsTotal.inc({ type: 'oj', verdict });
      this.judgeDurationMs.observe({ type: 'oj' }, Date.now() - startTime);
      await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`临时目录清理失败: ${workDir}: ${err}`);
      });
    }
  }
}
