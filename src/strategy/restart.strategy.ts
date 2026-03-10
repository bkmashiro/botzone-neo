import { Logger } from '@nestjs/common';
import { IBotRunStrategy } from './bot-run-strategy.interface';
import { BotContext, BotInput, BotOutput } from '../judge/types';
import { NsjailService } from '../sandbox/nsjail.service';
import { spawn } from 'child_process';

/**
 * 重启策略（默认）
 *
 * 每轮启动新的沙箱进程，通过 stdin 传入完整历史 JSON（官方协议格式），
 * 从 stdout 读取单行 JSON 输出。
 *
 * 生产环境通过 NsjailService 运行沙箱进程；
 * 开发环境（nsjail 不可用时）自动降级为直接 spawn。
 */
export class RestartStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(RestartStrategy.name);
  private nsjailAvailable: boolean | null = null;

  constructor(private readonly nsjailService?: NsjailService) {}

  /** 执行一轮：启动新进程，写入 stdin，读取 stdout */
  async runRound(botCtx: BotContext, input: BotInput): Promise<BotOutput> {
    const inputJson = JSON.stringify(input);

    // 尝试用 nsjail 运行（生产环境）
    if (this.nsjailService && (await this.isNsjailAvailable())) {
      return this.runWithNsjail(botCtx, inputJson);
    }

    // 降级为直接 spawn（开发环境）
    return this.runDirect(botCtx, inputJson);
  }

  /** 重启策略每轮结束后无需清理 */
  async afterRound(_botCtx: BotContext): Promise<void> {
    // 进程已退出，无需操作
  }

  /** 重启策略对局结束后无需额外清理 */
  async cleanup(_botCtx: BotContext): Promise<void> {
    // 无常驻资源
  }

  /** 通过 nsjail 沙箱执行 */
  private async runWithNsjail(
    botCtx: BotContext,
    inputJson: string,
  ): Promise<BotOutput> {
    const timeLimitSec = Math.ceil(botCtx.limit.time / 1000);
    const result = await this.nsjailService!.execute(
      {
        execPath: botCtx.execCmd,
        execArgs: botCtx.execArgs,
        workDir: botCtx.workDir,
        timeLimit: timeLimitSec,
        memoryLimit: botCtx.limit.memory,
      },
      inputJson,
    );

    if (result.timedOut) {
      return {
        response: '',
        debug: `TLE: 超过时间限制 ${botCtx.limit.time}ms`,
        verdict: 'TLE',
      };
    }

    if (result.exitCode !== 0) {
      this.logger.warn(
        `Bot ${botCtx.id} nsjail 退出码: ${result.exitCode}`,
      );
      return {
        response: '',
        debug: result.stderr || `进程异常退出 (code=${result.exitCode})`,
        verdict: 'RE',
      };
    }

    return this.parseOutput(result.stdout);
  }

  /** 直接 spawn 执行（开发环境 fallback） */
  private runDirect(
    botCtx: BotContext,
    inputJson: string,
  ): Promise<BotOutput> {
    return new Promise((resolve) => {
      const timeoutMs = botCtx.limit.time;

      const child = spawn(botCtx.execCmd, botCtx.execArgs, {
        cwd: botCtx.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const done = (output: BotOutput) => {
        if (resolved) return;
        resolved = true;
        resolve(output);
      };

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时处理
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done({
          response: '',
          debug: `TLE: 超过时间限制 ${timeoutMs}ms`,
          verdict: 'TLE',
        });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          this.logger.warn(
            `Bot ${botCtx.id} 退出码: ${code}, stderr: ${stderr}`,
          );
          done({
            response: '',
            debug: stderr || `进程异常退出 (code=${code})`,
            verdict: 'RE',
          });
          return;
        }

        done(this.parseOutput(stdout));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.logger.error(`Bot ${botCtx.id} spawn 失败: ${err.message}`);
        done({
          response: '',
          debug: `系统错误: ${err.message}`,
          verdict: 'SE',
        });
      });

      // 写入输入并关闭 stdin
      child.stdin.write(inputJson);
      child.stdin.end();
    });
  }

  /** 解析 Bot stdout：第一行 JSON */
  private parseOutput(stdout: string): BotOutput {
    const firstLine = stdout.trim().split('\n')[0] ?? '';
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

  /** 检测 nsjail 是否可用 */
  private async isNsjailAvailable(): Promise<boolean> {
    if (this.nsjailAvailable !== null) return this.nsjailAvailable;

    try {
      const { execSync } = await import('child_process');
      execSync('which nsjail', { stdio: 'ignore' });
      this.nsjailAvailable = true;
      this.logger.log('nsjail 可用，使用沙箱模式');
    } catch {
      this.nsjailAvailable = false;
      this.logger.warn(
        'nsjail 不可用，降级为直接执行模式（仅限开发环境）',
      );
    }
    return this.nsjailAvailable;
  }
}
