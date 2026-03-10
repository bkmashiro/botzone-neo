/**
 * 常驻进程策略
 *
 * 进程在首轮启动后保持运行，每轮通过 stdin/stdout 交互。
 * 轮间使用 SIGSTOP 暂停进程、SIGCONT 唤醒，对局结束时 SIGKILL。
 *
 * 适用于需要在多轮间保持内存状态的 Bot（如 Monte Carlo Tree Search）。
 *
 * 协议：每轮写入一行 JSON 到 stdin，从 stdout 读取一行输出。
 */

import { ChildProcess, spawn } from 'child_process';
import { Logger } from '@nestjs/common';
import { BotRuntime, BotInput, BotOutput } from '../../domain/bot';
import { IBotRunStrategy } from '../bot-run-strategy.interface';

/** 单轮 stdout 缓冲区上限（1MB），防止内存溢出 */
const MAX_BUFFER_SIZE = 1024 * 1024;

export class LongrunStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(LongrunStrategy.name);
  private child: ChildProcess | null = null;
  private exited = false;

  async runRound(bot: BotRuntime, input: BotInput): Promise<BotOutput> {
    if (!this.child) {
      this.spawnProcess(bot);
    } else {
      // 唤醒被 SIGSTOP 暂停的进程
      this.signal('SIGCONT');
    }

    const inputLine = JSON.stringify(input) + '\n';

    return new Promise<BotOutput>((resolve) => {
      // 收集一行 stdout 输出（限制缓冲区大小）
      let buffer = '';
      let settled = false;

      const settle = (result: BotOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        this.child?.stdout?.off('data', onData);
        resolve(result);
      };

      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();
        if (buffer.length > MAX_BUFFER_SIZE) {
          this.logger.warn(`Bot ${bot.id} 输出超过 ${MAX_BUFFER_SIZE} 字节限制`);
          this.signal('SIGKILL');
          this.exited = true;
          settle({ response: '', debug: 'OLE: 输出超过大小限制' });
          return;
        }
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          settle(this.parseOutput(line));
        }
      };

      const timeoutHandle = setTimeout(() => {
        this.logger.warn(`Bot ${bot.id} 超时 (${bot.limit.timeMs}ms)`);
        this.signal('SIGKILL');
        this.exited = true;
        settle({ response: '', debug: `TLE: 超过时间限制 ${bot.limit.timeMs}ms` });
      }, bot.limit.timeMs);

      this.child?.stdout?.on('data', onData);

      // 进程已退出则立即返回错误
      if (this.exited || !this.child) {
        settle({ response: '', debug: '进程已退出' });
        return;
      }

      // 写入本轮输入
      try {
        this.child?.stdin?.write(inputLine);
      } catch {
        settle({ response: '', debug: 'EPIPE: 无法写入进程 stdin' });
      }
    });
  }

  async afterRound(_bot: BotRuntime): Promise<void> {
    if (this.child && !this.exited) {
      this.signal('SIGSTOP');
    }
  }

  async cleanup(_bot: BotRuntime): Promise<void> {
    if (this.child && !this.exited) {
      this.signal('SIGKILL');
    }
    this.child = null;
    this.exited = false;
  }

  private spawnProcess(bot: BotRuntime): void {
    this.child = spawn(bot.compiled.cmd, bot.compiled.args, {
      cwd: bot.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = false;

    this.child.on('exit', (code) => {
      this.exited = true;
      this.logger.debug(`Bot ${bot.id} 进程退出 (code=${code})`);
    });

    this.child.on('error', (err) => {
      this.exited = true;
      this.logger.error(`Bot ${bot.id} 启动失败: ${err.message}`);
    });

    this.child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return;
      this.exited = true;
      this.logger.error(`Bot ${bot.id} stdin 错误: ${err.message}`);
    });

    // Prevent unhandled stream errors on stdout/stderr
    this.child.stdout?.on('error', () => {});
    this.child.stderr?.on('error', () => {});
  }

  private signal(sig: NodeJS.Signals): void {
    try {
      this.child?.kill(sig);
    } catch {
      this.logger.debug(`发送 ${sig} 失败，进程可能已退出`);
    }
  }

  private parseOutput(line: string): BotOutput {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const output = parsed as Record<string, unknown>;
        return {
          response: typeof output.response === 'string' ? output.response : '',
          debug: typeof output.debug === 'string' ? output.debug : undefined,
          data: typeof output.data === 'string' ? output.data : undefined,
          globaldata: typeof output.globaldata === 'string' ? output.globaldata : undefined,
        };
      }
    } catch {
      // 非 JSON，使用纯文本模式
    }
    return { response: line };
  }
}
