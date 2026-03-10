/**
 * RunMatchUseCase — Botzone 对局评测用例
 *
 * 编译 → 循环（裁判→Bot）→ 回报结果
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram } from 'prom-client';
import { trace } from '@opentelemetry/api';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { Match, MatchTask, CompileSummary } from '../domain/match';
import { JudgeCommand } from '../domain/round';
import { BotRuntime, BotInput, BotOutput, BotSpec } from '../domain/bot';
import { Verdict, CompileError } from '../domain/verdict';

import { CompileService } from '../infrastructure/compile/compile.service';
import { CallbackService } from '../infrastructure/callback/callback.service';
import { DataStoreService, SessionScope } from '../infrastructure/data-store/data-store.service';
import { ISandbox, SANDBOX_TOKEN } from '../infrastructure/sandbox/sandbox.interface';

import { IBotRunStrategy } from '../strategies/bot-run-strategy.interface';
import { RestartStrategy } from '../strategies/botzone/restart.strategy';
import { LongrunStrategy } from '../strategies/botzone/longrun.strategy';

/** 默认全局对局超时: 5 分钟 */
const DEFAULT_MAX_MATCH_DURATION_MS = 5 * 60 * 1000;

class MatchTimeoutError extends Error {
  constructor(ms: number) {
    super(`对局超时: 超过全局时间限制 ${ms}ms`);
  }
}

const tracer = trace.getTracer('botzone-neo', '1.0.0');

@Injectable()
export class RunMatchUseCase {
  private readonly logger = new Logger(RunMatchUseCase.name);
  private readonly maxMatchDurationMs: number;

  constructor(
    private readonly compileService: CompileService,
    private readonly callbackService: CallbackService,
    private readonly dataStoreService: DataStoreService,
    @Inject(SANDBOX_TOKEN) private readonly sandbox: ISandbox,
    configService: ConfigService,
    @InjectMetric('botzone_judge_requests_total') private readonly judgeRequestsTotal: Counter,
    @InjectMetric('botzone_judge_duration_ms') private readonly judgeDurationMs: Histogram,
    @InjectMetric('botzone_active_matches') private readonly activeMatches: Gauge,
  ) {
    this.maxMatchDurationMs = configService.get<number>(
      'MAX_MATCH_DURATION_MS',
      DEFAULT_MAX_MATCH_DURATION_MS,
    );
  }

  async execute(task: MatchTask): Promise<void> {
    return tracer.startActiveSpan('RunMatchUseCase.execute', async (span) => {
      span.setAttribute('match.runMode', task.runMode);
      span.setAttribute('match.botCount', task.bots.length);

      const match = new Match(task);
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botzone-'));
      const strategy = this.createStrategy(task.runMode);
      const bots = new Map<string, BotRuntime>();
      const histories = new Map<string, { requests: string[]; responses: string[] }>();
      const compiles: CompileSummary[] = [];
      const session = this.dataStoreService.createSession();

      // 全局超时控制
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new MatchTimeoutError(this.maxMatchDurationMs)),
          this.maxMatchDurationMs,
        );
      });

      this.logger.log(
        `对局开始: bots=${task.bots.map((b) => b.id).join(',')}, mode=${task.runMode}`,
      );

      this.activeMatches.inc();
      const startTime = Date.now();
      let verdict = Verdict.OK;

      try {
        const innerVerdict = await Promise.race([
          this.executeInner(task, match, workDir, strategy, bots, histories, compiles, session),
          timeoutPromise,
        ]);
        if (innerVerdict) verdict = innerVerdict;
      } catch (err) {
        if (err instanceof MatchTimeoutError) {
          this.logger.error(err.message);
          verdict = Verdict.TLE;
          if (!match.isFinished) {
            const scores: Record<string, number> = {};
            for (const spec of task.bots) {
              if (spec.id !== 'judger') scores[spec.id] = 0;
            }
            const result = match.finish(scores, compiles);
            await this.callbackService.finish(task.callback.finish, result);
          }
        } else {
          verdict = Verdict.SE;
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          this.logger.error(`对局异常: ${err instanceof Error ? err.message : String(err)}`);
          if (!match.isFinished) {
            const scores: Record<string, number> = {};
            for (const spec of task.bots) {
              if (spec.id !== 'judger') scores[spec.id] = 0;
            }
            const result = match.finish(scores, compiles);
            await this.callbackService.finish(task.callback.finish, result);
          }
        }
      } finally {
        span.setAttribute('match.verdict', verdict);
        span.end();
        this.activeMatches.dec();
        this.judgeRequestsTotal.inc({ type: 'botzone', verdict });
        this.judgeDurationMs.observe({ type: 'botzone' }, Date.now() - startTime);
        clearTimeout(timeoutHandle);
        for (const bot of bots.values()) {
          await strategy.cleanup(bot);
        }
        session.clear();
        await fs.rm(workDir, { recursive: true, force: true }).catch((cleanupErr) => {
          this.logger.warn(`临时目录清理失败: ${workDir}: ${cleanupErr}`);
        });
      }
    });
  }

  private async executeInner(
    task: MatchTask,
    match: Match,
    workDir: string,
    strategy: IBotRunStrategy,
    bots: Map<string, BotRuntime>,
    histories: Map<string, { requests: string[]; responses: string[] }>,
    compiles: CompileSummary[],
    session: SessionScope,
  ): Promise<Verdict | void> {
    // ── 阶段1: 编译所有代码 ──
    for (const spec of task.bots) {
      this.logger.debug(`编译 Bot: id=${spec.id}, language=${spec.language}`);
      const compileSummary = await this.compileBot(spec, workDir, bots);
      compiles.push(compileSummary);

      if (compileSummary.verdict !== Verdict.OK) {
        this.logger.warn(
          `编译失败导致对局结束: botId=${spec.id}, verdict=${compileSummary.verdict}`,
        );
        const scores: Record<string, number> = {};
        for (const b of task.bots) {
          if (b.id === 'judger') continue;
          scores[b.id] = b.id === spec.id ? 0 : 1;
        }
        const result = match.finish(scores, compiles);
        await this.callbackService.finish(task.callback.finish, result);
        return Verdict.CE;
      }
      histories.set(spec.id, { requests: [], responses: [] });
    }

    const initdata = task.initdata ?? '';

    while (match.hasRoundsLeft) {
      const round = match.nextRound();
      this.logger.debug(`对局轮次 ${round}`);

      const judgerBot = bots.get('judger');
      if (!judgerBot) {
        this.logger.error('未找到裁判代码');
        break;
      }

      const judgerHistory = histories.get('judger');
      if (!judgerHistory) break;
      if (round === 1) {
        judgerHistory.requests.push(initdata);
      }

      const judgerInput = await this.buildBotInput(judgerBot, judgerHistory, session);
      const judgerOutput = await strategy.runRound(judgerBot, judgerInput);
      await strategy.afterRound(judgerBot);

      if (!judgerOutput.response) {
        this.logger.error('裁判无输出');
        break;
      }

      await this.updatePersistentData(judgerBot.id, judgerOutput, session);
      judgerHistory.responses.push(judgerOutput.response);

      let judgeCmd: JudgeCommand;
      try {
        const parsed = JSON.parse(judgerOutput.response) as Record<string, unknown>;
        if (
          (parsed.command !== 'request' && parsed.command !== 'finish') ||
          !parsed.content ||
          typeof parsed.content !== 'object' ||
          Array.isArray(parsed.content)
        ) {
          this.logger.error(`裁判输出格式无效: 缺少 command 或 content`);
          break;
        }
        judgeCmd = parsed as unknown as JudgeCommand;
      } catch {
        this.logger.error('裁判输出 JSON 解析失败');
        break;
      }

      if (judgeCmd.command === 'finish') {
        this.logger.log(`对局正常结束: round=${round}`);
        const rawScores = judgeCmd.content as Record<string, unknown>;
        const scores: Record<string, number> = {};
        for (const [id, val] of Object.entries(rawScores)) {
          scores[id] = typeof val === 'number' && isFinite(val) ? val : 0;
        }
        const result = match.finish(scores, compiles);
        await this.callbackService.finish(task.callback.finish, result);
        return;
      }

      // 并行运行各 Bot（同一轮内各 Bot 互相独立）
      const botEntries = Object.entries(judgeCmd.content).filter(
        ([id]) => id !== 'judger' && bots.has(id),
      );

      const botResults = await Promise.all(
        botEntries.map(async ([botId, request]) => {
          const bot = bots.get(botId);
          const history = histories.get(botId);
          if (!bot || !history) return [botId, ''] as const;
          history.requests.push(String(request));

          const botInput = await this.buildBotInput(bot, history, session);
          const output: BotOutput = await strategy.runRound(bot, botInput);
          await strategy.afterRound(bot);

          await this.updatePersistentData(botId, output, session);
          history.responses.push(output.response);
          return [botId, output.response] as const;
        }),
      );

      const botResponses: Record<string, string> = {};
      for (const [botId, response] of botResults) {
        botResponses[botId] = response;
      }

      match.addLog({ round, judgeCmd, botResponses });
      judgerHistory.requests.push(JSON.stringify(botResponses));

      if (task.callback.update) {
        try {
          await this.callbackService.update(task.callback.update, {
            round,
            display: judgeCmd.display,
          });
        } catch (updateErr) {
          this.logger.warn(`进度回调失败 (round=${round}): ${updateErr}`);
        }
      }
    }

    this.logger.warn('对局超过最大轮次限制');
    const scores: Record<string, number> = {};
    for (const spec of task.bots) {
      if (spec.id !== 'judger') scores[spec.id] = 0;
    }
    const result = match.finish(scores, compiles);
    await this.callbackService.finish(task.callback.finish, result);
  }

  private async compileBot(
    spec: BotSpec,
    workDir: string,
    bots: Map<string, BotRuntime>,
  ): Promise<CompileSummary> {
    try {
      const compiled = await this.compileService.compile(spec.language, spec.source);
      const botWorkDir = path.join(workDir, spec.id);
      await fs.mkdir(botWorkDir, { recursive: true });

      bots.set(spec.id, {
        id: spec.id,
        compiled,
        workDir: botWorkDir,
        limit: spec.limit,
      });

      return { botId: spec.id, verdict: Verdict.OK };
    } catch (err) {
      if (err instanceof CompileError) {
        return { botId: spec.id, verdict: Verdict.CE, message: err.message };
      }
      throw err;
    }
  }

  private async buildBotInput(
    bot: BotRuntime,
    history: { requests: string[]; responses: string[] },
    session: SessionScope,
  ): Promise<BotInput> {
    return {
      requests: history.requests,
      responses: history.responses,
      data: session.getData(bot.id),
      globaldata: await this.dataStoreService.getGlobalData(bot.id),
      time_limit: bot.limit.timeMs / 1000,
      memory_limit: bot.limit.memoryMb,
    };
  }

  private async updatePersistentData(
    botId: string,
    output: BotOutput,
    session: SessionScope,
  ): Promise<void> {
    if (output.data !== undefined) {
      session.setData(botId, output.data);
    }
    if (output.globaldata !== undefined) {
      await this.dataStoreService.setGlobalData(botId, output.globaldata);
    }
  }

  private createStrategy(mode: string): IBotRunStrategy {
    switch (mode) {
      case 'longrun':
        return new LongrunStrategy();
      case 'restart':
      default:
        return new RestartStrategy(this.sandbox);
    }
  }
}
