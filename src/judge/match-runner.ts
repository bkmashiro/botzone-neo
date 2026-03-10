import { Injectable, Logger } from '@nestjs/common';
import { CompileService } from '../compile/compile.service';
import { CallbackService } from '../callback/callback.service';
import { DataStoreService } from '../data-store/data-store.service';
import { NsjailService } from '../sandbox/nsjail.service';
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
    private readonly nsjailService: NsjailService,
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
      // ── 阶段1：编译所有代码 ──
      for (const [id, code] of Object.entries(task.game)) {
        const result: CompileResult = await this.compileService.compile(code.language, code.source);
        compileResults[id] = {
          verdict: result.verdict,
          message: result.message,
        };

        if (result.verdict !== 'OK') {
          // 编译失败，立即结束：失败方得 0 分，其余得 1 分
          const scores: Record<string, number> = {};
          for (const botId of Object.keys(task.game)) {
            scores[botId] = botId === id ? 0 : 1;
          }
          const gameResult: GameResult = {
            scores,
            log,
            compile: compileResults,
          };
          await this.callbackService.finish(task.callback.finish, gameResult);
          return;
        }

        // 创建 bot 上下文
        const botWorkDir = path.join(workDir, id);
        await fs.mkdir(botWorkDir, { recursive: true });
        botContexts.set(id, {
          id,
          language: code.language,
          execCmd: result.execCmd!,
          execArgs: result.execArgs ?? [],
          workDir: botWorkDir,
          limit: code.limit,
        });
        histories.set(id, { requests: [], responses: [] });
      }

      // ── 阶段2：对局循环 ──
      let round = 0;
      const initdataStr: string =
        typeof task.initdata === 'object' ? JSON.stringify(task.initdata) : (task.initdata ?? '');

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

        // 首轮裁判的 request 包含 initdata
        if (round === 1) {
          judgerHistory.requests.push(initdataStr);
        }

        const judgerBotInput: BotInput = {
          requests: judgerHistory.requests,
          responses: judgerHistory.responses,
          data: await this.dataStoreService.getData(judgerCtx.id),
          globaldata: await this.dataStoreService.getGlobalData(judgerCtx.id),
          time_limit: judgerCtx.limit.time,
          memory_limit: judgerCtx.limit.memory,
        };

        const judgerOutput = await strategy.runRound(judgerCtx, judgerBotInput);
        await strategy.afterRound(judgerCtx);

        // 裁判运行异常
        if (judgerOutput.verdict && judgerOutput.verdict !== 'OK') {
          this.logger.error(`裁判运行异常: ${judgerOutput.verdict} - ${judgerOutput.debug}`);
          log.push({
            judge: {
              error: judgerOutput.verdict,
              debug: judgerOutput.debug,
            },
          });
          break;
        }

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
          log.push({
            judge: { error: 'INVALID_JSON', raw: judgerOutput.response },
          });
          break;
        }

        judgerHistory.responses.push(judgerOutput.response);
        log.push({ judge: judgeResult });

        // ── 判定是否结束 ──
        if (judgeResult.command === 'finish') {
          const scores = judgeResult.content as Record<string, number>;
          const gameResult: GameResult = {
            scores,
            log,
            compile: compileResults,
          };
          await this.callbackService.finish(task.callback.finish, gameResult);
          return;
        }

        // ── command === "request"：向各 bot 发送请求 ──
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
            time_limit: ctx.limit.time,
            memory_limit: ctx.limit.memory,
          };

          const output: BotOutput = await strategy.runRound(ctx, botInput);
          await strategy.afterRound(ctx);

          // 记录 bot 运行时错误（TLE/RE/MLE 等），但仍继续对局让裁判判定
          if (output.verdict && output.verdict !== 'OK') {
            this.logger.warn(`Bot ${botId} 运行异常: ${output.verdict} - ${output.debug}`);
          }

          // 更新持久化数据
          if (output.data !== undefined) {
            await this.dataStoreService.setData(botId, output.data);
          }
          if (output.globaldata !== undefined) {
            await this.dataStoreService.setGlobalData(botId, output.globaldata);
          }

          history.responses.push(output.response);
          botOutputs[botId] = output.response;
          log.push({
            [botId]: {
              response: output.response,
              debug: output.debug,
              verdict: output.verdict,
            },
          });
        }

        // 将 bot 回复汇总给裁判作为下一轮的 request
        judgerHistory.requests.push(JSON.stringify(botOutputs));

        // 回报当前轮进度
        await this.callbackService.update(task.callback.update, {
          round,
          display: judgeResult.display,
        });
      }

      // 超过最大轮次 或 裁判异常退出
      this.logger.warn('对局异常结束（超过最大轮次或裁判异常）');
      const scores: Record<string, number> = {};
      for (const botId of Object.keys(task.game)) {
        if (botId !== 'judger') scores[botId] = 0;
      }
      const gameResult: GameResult = {
        scores,
        log,
        compile: compileResults,
      };
      await this.callbackService.finish(task.callback.finish, gameResult);
    } finally {
      // 清理策略资源和临时目录
      for (const ctx of botContexts.values()) {
        await strategy.cleanup(ctx);
      }
      this.dataStoreService.clearSessionData();
      await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`临时目录清理失败: ${workDir}: ${err}`);
      });
    }
  }

  /** 根据运行模式创建策略 */
  private createStrategy(mode: string): IBotRunStrategy {
    switch (mode) {
      case 'longrun':
        return new LongrunStrategy();
      case 'restart':
      default:
        return new RestartStrategy(this.nsjailService);
    }
  }
}
