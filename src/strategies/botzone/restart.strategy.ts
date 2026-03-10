/**
 * 重启策略（默认）
 *
 * 每轮启动新的沙箱进程，通过 stdin 传入完整历史 JSON（官方协议格式），
 * 从 stdout 读取单行 JSON 输出。
 *
 * 不依赖 NestJS，不直接 spawn 进程——通过 ISandbox 接口执行。
 */

import { BotRuntime, BotInput, BotOutput } from '../../domain/bot';
import { ISandbox } from '../../infrastructure/sandbox/sandbox.interface';
import { IBotRunStrategy } from '../bot-run-strategy.interface';

export class RestartStrategy implements IBotRunStrategy {
  constructor(private readonly sandbox: ISandbox) {}

  async runRound(bot: BotRuntime, input: BotInput): Promise<BotOutput> {
    const inputJson = JSON.stringify(input);

    const result = await this.sandbox.execute({
      compiled: bot.compiled,
      workDir: bot.workDir,
      limit: bot.limit,
      stdin: inputJson,
    });

    // 超时
    if (result.timedOut) {
      return {
        response: '',
        debug: `TLE: 超过时间限制 ${bot.limit.timeMs}ms`,
      };
    }

    // 非零退出码
    if (result.exitCode !== 0) {
      return {
        response: '',
        debug: result.stderr || `进程异常退出 (code=${result.exitCode})`,
      };
    }

    // 解析第一行 JSON 输出
    const firstLine = result.stdout.trim().split('\n')[0] ?? '';
    try {
      const output = JSON.parse(firstLine) as BotOutput;
      return {
        response: output.response ?? '',
        debug: output.debug,
        data: output.data,
        globaldata: output.globaldata,
      };
    } catch {
      // 兼容：如果输出不是 JSON，整行作为 response
      return { response: firstLine };
    }
  }

  async afterRound(_bot: BotRuntime): Promise<void> {
    // 进程已退出，无需操作
  }

  async cleanup(_bot: BotRuntime): Promise<void> {
    // 无常驻资源
  }
}
