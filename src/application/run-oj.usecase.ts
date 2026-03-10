/**
 * RunOJUseCase — OJ 评测编排
 *
 * 遍历 testcase，逐个运行选手程序并判题。
 * 支持 standard（diff）和 checker（special judge）两种模式。
 */

import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { OJTask, OJResult, TestcaseResult } from '../domain/oj/testcase';
import { Verdict, CompileError } from '../domain/verdict';
import { CompiledArtifact } from '../infrastructure/process/jobs/compile.job.types';
import { CompileUseCase } from './compile.usecase';
import { ISandboxFactory, SandboxConfig } from '../infrastructure/process/sandbox-factory';
import { RunInput } from '../infrastructure/process/process-io';
import { StandardStrategy } from '../strategies/oj/standard.strategy';
import { CheckerStrategy, CheckerConfig } from '../strategies/oj/checker.strategy';
import { CallbackService } from '../infrastructure/callback/callback.service';

@Injectable()
export class RunOJUseCase {
  private readonly logger = new Logger(RunOJUseCase.name);
  private readonly standardStrategy = new StandardStrategy();

  constructor(
    private readonly compileUseCase: CompileUseCase,
    private readonly callbackService: CallbackService,
    private readonly sandboxFactory: ISandboxFactory,
  ) {}

  /** 执行 OJ 评测 */
  async execute(task: OJTask): Promise<void> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-'));
    const results: TestcaseResult[] = [];

    try {
      // ── 阶段 1：编译选手代码 ──────────────────────────
      let artifact: CompiledArtifact;
      try {
        artifact = await this.compileUseCase.compile(task.language, task.source);
      } catch (err) {
        if (err instanceof CompileError) {
          const ojResult: OJResult = {
            verdict: Verdict.CE,
            testcases: [],
            compile: { verdict: Verdict.CE, message: err.message },
          };
          await this.callbackService.finish(task.callback.finish, ojResult);
          return;
        }
        throw err;
      }

      // ── 阶段 1.5：编译 checker（如需要）─────────────────
      let checkerArtifact: CompiledArtifact | undefined;
      if (task.judgeMode === 'checker' && task.checkerSource && task.checkerLanguage) {
        try {
          checkerArtifact = await this.compileUseCase.compile(
            task.checkerLanguage,
            task.checkerSource,
          );
        } catch (err) {
          if (err instanceof CompileError) {
            const ojResult: OJResult = {
              verdict: Verdict.SE,
              testcases: [],
              compile: { verdict: Verdict.OK, message: 'Checker 编译失败: ' + err.message },
            };
            await this.callbackService.finish(task.callback.finish, ojResult);
            return;
          }
          throw err;
        }
      }

      // ── 阶段 2：逐个测试用例评测 ─────────────────────
      let overallVerdict: Verdict = Verdict.AC;

      for (const tc of task.testcases) {
        const tcTimeMs = tc.timeLimitMs ?? task.timeLimitMs;
        const tcMemMb = tc.memoryLimitMb ?? task.memoryLimitMb;

        const sandboxConfig: SandboxConfig = {
          timeoutMs: tcTimeMs,
          memoryMb: tcMemMb,
          readonlyMounts: artifact.readonlyMounts,
          workDir,
        };

        const job = this.sandboxFactory.create(sandboxConfig);

        const runInput: RunInput = {
          cmd: artifact.cmd,
          args: artifact.args,
          cwd: workDir,
          stdin: tc.input,
          timeoutMs: tcTimeMs,
        };

        const { result, usage } = await job.execute(runInput);

        // 超时
        if (result.timedOut) {
          results.push({
            id: tc.id,
            verdict: Verdict.TLE,
            timeMs: usage.timeMs,
            memoryKb: usage.memoryKb,
          });
          overallVerdict = Verdict.TLE;
          continue;
        }

        // 运行时错误
        if (result.exitCode !== 0) {
          results.push({
            id: tc.id,
            verdict: Verdict.RE,
            message: result.stderr || `exit code ${result.exitCode}`,
            timeMs: usage.timeMs,
            memoryKb: usage.memoryKb,
          });
          overallVerdict = Verdict.RE;
          continue;
        }

        // 判题
        let tcVerdict: Verdict;
        let tcMessage: string | undefined;

        if (task.judgeMode === 'checker' && checkerArtifact) {
          const checkerStrategy = new CheckerStrategy(this.sandboxFactory);
          const checkerWorkDir = path.join(workDir, 'checker');
          await fs.mkdir(checkerWorkDir, { recursive: true });

          const checkerConfig: CheckerConfig = {
            artifact: checkerArtifact,
            workDir: checkerWorkDir,
            timeoutMs: 10_000,
            memoryMb: 256,
          };

          const checkerResult = await checkerStrategy.judge({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            actualOutput: result.stdout,
          }, checkerConfig);

          tcVerdict = checkerResult.verdict === Verdict.AC ? Verdict.AC : Verdict.WA;
          tcMessage = checkerResult.message;
        } else {
          const judgeResult = this.standardStrategy.judge(result.stdout, tc.expectedOutput);
          tcVerdict = judgeResult.verdict;
          tcMessage = judgeResult.message;
        }

        if (tcVerdict !== Verdict.AC && overallVerdict === Verdict.AC) {
          overallVerdict = tcVerdict;
        }

        results.push({
          id: tc.id,
          verdict: tcVerdict,
          actualOutput: result.stdout,
          timeMs: usage.timeMs,
          memoryKb: usage.memoryKb,
          message: tcMessage,
        });
      }

      // ── 阶段 3：回报结果 ──────────────────────────────
      const ojResult: OJResult = {
        verdict: overallVerdict,
        testcases: results,
        compile: { verdict: Verdict.OK },
      };
      await this.callbackService.finish(task.callback.finish, ojResult);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
