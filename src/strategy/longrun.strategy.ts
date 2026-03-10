import { ChildProcess, spawn } from 'child_process';
import { Logger } from '@nestjs/common';
import { IBotRunStrategy } from './bot-run-strategy.interface';
import { BotContext, BotInput, BotOutput } from '../judge/types';

/**
 * 常驻进程策略
 *
 * 进程在首轮启动后保持运行，每轮通过 stdin/stdout 交互。
 * 轮间使用 SIGSTOP 暂停进程、SIGCONT 唤醒，对局结束时 SIGKILL。
 *
 * 适用于需要在多轮间保持内存状态的 Bot（如 Monte Carlo Tree Search）。
 */
export class LongrunStrategy implements IBotRunStrategy {
  private readonly logger = new Logger(LongrunStrategy.name);
  private child: ChildProcess | null = null;
  private exited = false;

  async runRound(botCtx: BotContext, input: BotInput): Promise<BotOutput> {
    if (!this.child) {
      this.spawnProcess(botCtx);
    } else {
      this.signal('SIGCONT');
    }

    const inputLine = JSON.stringify(input) + '\n';

    return new Promise<BotOutput>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.logger.warn(`Bot ${botCtx.id} 超时 (${botCtx.limit.time}ms)`);
        resolve({ response: '', debug: `TLE: 超过时间限制 ${botCtx.limit.time}ms` });
      }, botCtx.limit.time);

      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          clearTimeout(timeoutHandle);
          this.child?.stdout?.off('data', onData);
          const line = buffer.slice(0, newlineIdx).trim();
          resolve(this.parseOutput(line));
        }
      };

      this.child!.stdout!.on('data', onData);

      if (this.exited) {
        clearTimeout(timeoutHandle);
        this.child?.stdout?.off('data', onData);
        resolve({ response: '', debug: '进程已退出' });
        return;
      }

      try {
        this.child!.stdin!.write(inputLine);
      } catch {
        clearTimeout(timeoutHandle);
        this.child?.stdout?.off('data', onData);
        resolve({ response: '', debug: 'EPIPE: 无法写入进程 stdin' });
      }
    });
  }

  async afterRound(_botCtx: BotContext): Promise<void> {
    if (this.child && !this.exited) {
      this.signal('SIGSTOP');
    }
  }

  async cleanup(_botCtx: BotContext): Promise<void> {
    if (this.child && !this.exited) {
      this.signal('SIGKILL');
    }
    this.child = null;
  }

  private spawnProcess(botCtx: BotContext): void {
    this.child = spawn(botCtx.execCmd, botCtx.execArgs, {
      cwd: botCtx.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = false;

    this.child.on('exit', (code) => {
      this.exited = true;
      this.logger.debug(`Bot ${botCtx.id} 进程退出 (code=${code})`);
    });

    this.child.stdin!.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') throw err;
    });
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
        const output = parsed as BotOutput;
        return {
          response: output.response ?? '',
          debug: output.debug,
          data: output.data,
          globaldata: output.globaldata,
        };
      }
    } catch {
      // 非 JSON，使用纯文本模式
    }
    return { response: line };
  }
}
