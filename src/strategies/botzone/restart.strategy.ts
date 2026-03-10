/**
 * 重启策略（默认）
 *
 * 每轮启动新的沙箱进程，通过 stdin 传入完整历史 JSON（官方协议格式），
 * 从 stdout 读取单行 JSON 输出。
 *
 * 同时支持简化交互模式（Botzone 官方 wiki 定义）：
 * Bot 输出首行是纯数字时，判定为简化模式，按如下格式解析：
 *   第1行: response
 *   第2行(可选): data
 *   第3行(可选): globaldata
 *
 * 不依赖 NestJS，不直接 spawn 进程——通过 ISandbox 接口执行。
 */

import { Logger } from '@nestjs/common';
import { BotRuntime, BotInput, BotOutput } from '../../domain/bot';
import { ISandbox } from '../../infrastructure/sandbox/sandbox.interface';
import { IBotRunStrategy } from '../bot-run-strategy.interface';

export class RestartStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(RestartStrategy.name);

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
      this.logger.error(
        `Bot ${bot.id} 非零退出: code=${result.exitCode} stderr=${result.stderr?.slice(0, 200)}`,
      );
      return {
        response: '',
        debug: result.stderr || `进程异常退出 (code=${result.exitCode})`,
      };
    }

    this.logger.debug(
      `Bot ${bot.id} stdout=${JSON.stringify(result.stdout?.slice(0, 100))} stderr=${result.stderr?.slice(0, 50)}`,
    );
    return this.parseOutput(result.stdout);
  }

  /** 解析 Bot 输出：支持 JSON 模式和简化交互模式 */
  parseOutput(stdout: string): BotOutput {
    const lines = stdout.trim().split('\n');
    const firstLine = lines[0] ?? '';

    // 尝试 JSON 对象模式（必须是 {} 包裹的对象，排除纯数字/字符串等）
    try {
      const parsed: unknown = JSON.parse(firstLine);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const output = parsed as Record<string, unknown>;
        // If the JSON has a "command" field (judger output), the whole line IS the response
        // If the JSON has a "response" field (structured bot output), use that
        // Priority:
        // 1. explicit "response" field (structured bot output)
        // 2. "command" field → judger output, pass whole line
        // 3. Any other JSON object → pass whole line as response (e.g. {"0": 4})
        const response = typeof output.response === 'string' ? output.response : firstLine; // judger cmd or plain move JSON — pass whole line
        return {
          response,
          debug: typeof output.debug === 'string' ? output.debug : undefined,
          data: typeof output.data === 'string' ? output.data : undefined,
          globaldata: typeof output.globaldata === 'string' ? output.globaldata : undefined,
        };
      }
    } catch {
      this.logger.debug(`Bot 输出非 JSON，使用简化交互模式: "${firstLine.slice(0, 50)}"`);
    }

    // 简化交互模式：第1行 response，第2行 data，第3行 globaldata
    return {
      response: firstLine,
      data: lines[1],
      globaldata: lines[2],
    };
  }

  async afterRound(_bot: BotRuntime): Promise<void> {
    // 进程已退出，无需操作
  }

  async cleanup(_bot: BotRuntime): Promise<void> {
    // 无常驻资源
  }
}
