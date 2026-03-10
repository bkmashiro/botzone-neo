/**
 * RunMatchUseCase — Botzone 对局评测用例
 *
 * 编译 → 循环（裁判→Bot）→ 回报结果
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
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

@Injectable()
export class RunMatchUseCase {
  private readonly logger = new Logger(RunMatchUseCase.name);

  constructor(
    private readonly compileService: CompileService,
    private readonly callbackService: CallbackService,
    private readonly dataStoreService: DataStoreService,
    @Inject(SANDBOX_TOKEN) private readonly sandbox: ISandbox,
  ) {}

  async execute(task: MatchTask): Promise<void> {
    const match = new Match(task);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botzone-'));
    const strategy = this.createStrategy(task.runMode);
    const bots = new Map<string, BotRuntime>();
    const histories = new Map<string, { requests: string[]; responses: string[] }>();
    const compiles: CompileSummary[] = [];
    const session = this.dataStoreService.createSession();

    try {
      // ── 阶段1: 编译所有代码 ──
      for (const spec of task.bots) {
        const compileSummary = await this.compileBot(spec, workDir, bots);
        compiles.push(compileSummary);

        if (compileSummary.verdict !== Verdict.OK) {
          const scores: Record<string, number> = {};
          for (const b of task.bots) {
            if (b.id === 'judger') continue;
            scores[b.id] = b.id === spec.id ? 0 : 1;
          }
          const result = match.finish(scores, compiles);
          await this.callbackService.finish(task.callback.finish, result);
          return;
        }
        histories.set(spec.id, { requests: [], responses: [] });
      }

      // ── 阶段2: 对局循环 ──
      const initdata = task.initdata ?? '';

      while (match.hasRoundsLeft) {
        const round = match.nextRound();
        this.logger.debug(`对局轮次 ${round}`);

        // 运行裁判
        const judgerBot = bots.get('judger');
        if (!judgerBot) {
          this.logger.error('未找到裁判代码');
          break;
        }

        const judgerHistory = histories.get('judger')!;
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

        // 解析裁判输出
        let judgeCmd: JudgeCommand;
        try {
          judgeCmd = JSON.parse(judgerOutput.response) as JudgeCommand;
        } catch {
          this.logger.error('裁判输出 JSON 解析失败');
          break;
        }

        // 判定是否结束
        if (judgeCmd.command === 'finish') {
          const scores = judgeCmd.content as Record<string, number>;
          const result = match.finish(scores, compiles);
          await this.callbackService.finish(task.callback.finish, result);
          return;
        }

        // command === "request": 向各 bot 发送请求
        const botResponses: Record<string, string> = {};
        for (const [botId, request] of Object.entries(judgeCmd.content)) {
          if (botId === 'judger') continue;
          const bot = bots.get(botId);
          if (!bot) continue;

          const history = histories.get(botId)!;
          history.requests.push(String(request));

          const botInput = await this.buildBotInput(bot, history, session);
          const output: BotOutput = await strategy.runRound(bot, botInput);
          await strategy.afterRound(bot);

          await this.updatePersistentData(botId, output, session);
          history.responses.push(output.response);
          botResponses[botId] = output.response;
        }

        match.addLog({ round, judgeCmd, botResponses });

        // 将 bot 回复汇总给裁判作为下一轮的 request
        judgerHistory.requests.push(JSON.stringify(botResponses));

        // 回报当前轮进度
        await this.callbackService.update(task.callback.update, {
          round,
          display: judgeCmd.display,
        });
      }

      // 超过最大轮次
      this.logger.warn('对局超过最大轮次限制');
      const scores: Record<string, number> = {};
      for (const spec of task.bots) {
        if (spec.id !== 'judger') scores[spec.id] = 0;
      }
      const result = match.finish(scores, compiles);
      await this.callbackService.finish(task.callback.finish, result);
    } finally {
      for (const bot of bots.values()) {
        await strategy.cleanup(bot);
      }
      session.clear();
      await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`临时目录清理失败: ${workDir}: ${err}`);
      });
    }
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
