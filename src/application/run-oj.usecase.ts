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
import { Counter, Histogram } from 'prom-client';

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
  ) {}

  async execute(task: OJTask): Promise<void> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-'));
    this.logger.log(`OJ 评测开始: language=${task.language}, testcases=${task.testcases.length}`);
    const startTime = Date.now();
    let verdict = Verdict.AC;

    try {
      // ── 编译用户代码 ──
      let compiled;
      this.logger.debug(`编译用户代码: language=${task.language}`);
      try {
        compiled = await this.compileService.compile(task.language, task.source);
        this.logger.debug('用户代码编译成功');
      } catch (err) {
        if (err instanceof CompileError) {
          this.logger.warn(`用户代码编译失败: ${err.message}`);
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
        this.logger.debug(`编译自定义 Checker: language=${task.checkerLanguage}`);
        try {
          const checkerCompiled = await this.compileService.compile(
            task.checkerLanguage,
            task.checkerSource,
          );
          const checkerWorkDir = path.join(workDir, 'checker');
          await fs.mkdir(checkerWorkDir, { recursive: true });
          checker = new CustomChecker(this.sandbox, checkerCompiled, checkerWorkDir);
          this.logger.debug('自定义 Checker 编译成功');
        } catch (err) {
          if (err instanceof CompileError) {
            this.logger.warn(`Checker 编译失败: ${err.message}`);
            verdict = Verdict.CE;
            const result: OJResult = {
              verdict: Verdict.CE,
              testcases: [],
              compile: { verdict: Verdict.CE, message: `checker: ${err.message}` },
            };
            await this.callbackService.finish(task.callback.finish, result);
            return;
          }
          throw err;
        }
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

        const tcStartTime = Date.now();

        const sandboxResult = await this.sandbox.execute({
          compiled,
          workDir: tcWorkDir,
          limit: tcLimit,
          stdin: tc.input,
        });

        const timeMs = Date.now() - tcStartTime;
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

      this.logger.log(
        `OJ 评测完成: verdict=${overallVerdict}, testcases=${testcaseResults.length}`,
      );
      verdict = overallVerdict as Verdict;
      const result: OJResult = {
        verdict: overallVerdict,
        testcases: testcaseResults,
        compile: { verdict: Verdict.OK },
      };
      await this.callbackService.finish(task.callback.finish, result);
    } finally {
      this.judgeRequestsTotal.inc({ type: 'oj', verdict });
      this.judgeDurationMs.observe({ type: 'oj' }, Date.now() - startTime);
      await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`临时目录清理失败: ${workDir}: ${err}`);
      });
    }
  }
}
