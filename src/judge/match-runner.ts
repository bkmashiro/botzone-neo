import { Injectable, Logger } from '@nestjs/common';
import { CompileService } from '../compile/compile.service';
import { CallbackService } from '../callback/callback.service';
import { DataStoreService } from '../data-store/data-store.service';
import {
  Task,
  BotContext,
  BotInput,
  BotOutput,
  JudgeOutput,
  GameResult,
  CompileResult,
  Verdict,
} from './types';
import { IBotRunStrategy } from '../strategy/bot-run-strategy.interface';
import { RestartStrategy } from '../strategy/restart.strategy';
import { LongrunStrategy } from '../strategy/longrun.strategy';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

/** 最大对局轮数（安全上限） */
const MAX_ROUNDS = 1000;

/**
 * 对局主控：编译 → 循环（裁判→Bot）→ 回报结果
 */
@Injectable()
export class MatchRunner {
  private readonly logger = new Logger(MatchRunner.name);

  constructor(
    private readonly compileService: CompileService,
    private readonly callbackService: CallbackService,
    private readonly dataStoreService: DataStoreService,
  ) {}

  /** 执行一场完整对局 */
  async run(task: Task): Promise<void> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botzone-'));
    const log: unknown[] = [];
    const compileResults: Record<string, { verdict: Verdict; message?: string }> = {};
    const botContexts: Map<string, BotContext> = new Map();
    const histories: Map<string, { requests: string[]; responses: string[] }> = new Map();
    const strategy = this.createStrategy(task.runMode ?? 'restart');

    try {
      // 阶段1：编译所有代码
      for (const [id, code] of Object.entries(task.game)) {
        const result: CompileResult = await this.compileService.compile(
          code.language,
          code.source,
        );
        compileResults[id] = { verdict: result.verdict, message: result.message };

        if (result.verdict !== 'OK') {
          // 编译失败，立即结束
          const scores: Record<string, number> = {};
          for (const botId of Object.keys(task.game)) {
            scores[botId] = botId === id ? 0 : 1;
          }
          const gameResult: GameResult = { scores, log, compile: compileResults };
          await this.callbackService.finish(task.callback.finish, gameResult);
          return;
        }

        // 创建 bot 上下文
        const botWorkDir = path.join(workDir, id);
        await fs.mkdir(botWorkDir, { recursive: true });
        botContexts.set(id, {
          id,
          language: code.language,
          execPath: result.execPath!,
          workDir: botWorkDir,
          limit: code.limit,
        });
        histories.set(id, { requests: [], responses: [] });
      }

      // 阶段2：对局循环
      let round = 0;
      let judgeInput: string = typeof task.initdata === 'object'
        ? JSON.stringify(task.initdata)
        : (task.initdata ?? '');

      while (round < MAX_ROUNDS) {
        round++;
        this.logger.debug(`对局轮次 ${round}`);

        // 运行裁判
        const judgerCtx = botContexts.get('judger');
        if (!judgerCtx) {
          this.logger.error('未找到裁判代码');
          break;
        }

        const judgerHistory = histories.get('judger')!;
        const judgerInput: BotInput = {
          requests: judgerHistory.requests,
          responses: judgerHistory.responses,
          data: await this.dataStoreService.getData(judgerCtx.id),
          globaldata: await this.dataStoreService.getGlobalData(judgerCtx.id),
          timeLimit: judgerCtx.limit.time / 1000,
          memoryLimit: judgerCtx.limit.memory,
        };

        // 首轮裁判的 request 包含 initdata
        if (round === 1) {
          judgerHistory.requests.push(judgeInput);
        }

        const judgerOutput = await strategy.runRound(judgerCtx, judgerInput);
        await strategy.afterRound(judgerCtx);

        if (!judgerOutput.response) {
          this.logger.error('裁判无输出');
          break;
        }

        // 更新裁判持久化数据
        if (judgerOutput.data !== undefined) {
          await this.dataStoreService.setData(judgerCtx.id, judgerOutput.data);
        }

        // 解析裁判输出
        let judgeResult: JudgeOutput;
        try {
          judgeResult = JSON.parse(judgerOutput.response) as JudgeOutput;
        } catch {
          this.logger.error('裁判输出 JSON 解析失败');
          break;
        }

        judgerHistory.responses.push(judgerOutput.response);
        log.push({ judge: judgeResult });

        // 判定是否结束
        if (judgeResult.command === 'finish') {
          const scores = judgeResult.content as Record<string, number>;
          const gameResult: GameResult = { scores, log, compile: compileResults };
          await this.callbackService.finish(task.callback.finish, gameResult);
          return;
        }

        // command === "request"：向各 bot 发送请求
        const botOutputs: Record<string, string> = {};
        for (const [botId, request] of Object.entries(judgeResult.content)) {
          if (botId === 'judger') continue;
          const ctx = botContexts.get(botId);
          if (!ctx) continue;

          const history = histories.get(botId)!;
          history.requests.push(String(request));

          const botInput: BotInput = {
            requests: history.requests,
            responses: history.responses,
            data: await this.dataStoreService.getData(botId),
            globaldata: await this.dataStoreService.getGlobalData(botId),
            timeLimit: ctx.limit.time / 1000,
            memoryLimit: ctx.limit.memory,
          };

          const output: BotOutput = await strategy.runRound(ctx, botInput);
          await strategy.afterRound(ctx);

          // 更新持久化数据
          if (output.data !== undefined) {
            await this.dataStoreService.setData(botId, output.data);
          }
          if (output.globaldata !== undefined) {
            await this.dataStoreService.setGlobalData(botId, output.globaldata);
          }

          history.responses.push(output.response);
          botOutputs[botId] = output.response;
          log.push({ [botId]: { response: output.response, debug: output.debug } });
        }

        // 将 bot 回复汇总给裁判作为下一轮的 request
        judgerHistory.requests.push(JSON.stringify(botOutputs));

        // 回报当前轮进度
        await this.callbackService.update(task.callback.update, {
          round,
          display: judgeResult.display,
        });
      }

      // 超过最大轮次
      this.logger.warn('对局超过最大轮次限制');
      const scores: Record<string, number> = {};
      for (const botId of Object.keys(task.game)) {
        if (botId !== 'judger') scores[botId] = 0;
      }
      const gameResult: GameResult = { scores, log, compile: compileResults };
      await this.callbackService.finish(task.callback.finish, gameResult);
    } finally {
      // 清理策略资源和临时目录
      for (const ctx of botContexts.values()) {
        await strategy.cleanup(ctx);
      }
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** 根据运行模式创建策略 */
  private createStrategy(mode: string): IBotRunStrategy {
    switch (mode) {
      case 'longrun':
        return new LongrunStrategy();
      case 'restart':
      default:
        return new RestartStrategy(/* nsjailService 将由 DI 注入 */);
    }
  }
}
