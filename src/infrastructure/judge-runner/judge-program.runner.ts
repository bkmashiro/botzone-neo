/**
 * JudgeProgramRunner
 *
 * Manages a long-running judge process. Each round it writes one JSON line to
 * the process stdin and reads one JSON line from stdout.
 *
 * Judge stdin protocol  (one line per round):
 *   {"round": 1, "responses": {}}            ← round 1, no prior responses
 *   {"round": 2, "responses": {"0": 42}}     ← subsequent rounds
 *
 * Judge stdout protocol (one line per round):
 *   {"commands": {...}, "display": {...}, "verdict": "continue", "debug": "..."}
 *   {"commands": {}, "display": {...}, "verdict": "finish", "scores": {...}, "debug": "..."}
 *
 * Judge stderr is always collected as debug info.
 */

import { ChildProcess, spawn } from 'child_process';
import { Logger } from '@nestjs/common';
import { CompiledBot } from '../../domain/bot';

/** Maximum size of the stdout buffer (1 MB) to prevent memory blow-up */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Judge spec accepted by the runner */
export interface JudgeSpec {
  source: string;
  language: string;
}

/** Per-round result returned by the runner */
export interface JudgeRunnerRoundResult {
  commands: Record<string, unknown>;
  display?: unknown;
  verdict: 'continue' | 'finish' | 'error';
  scores?: Record<string, number>;
  debug?: string;
  stderr?: string;
  error?: string;
}

/**
 * JudgeProgramRunner
 *
 * Owns the judge child process. Callers compile the judge externally and pass
 * the `CompiledBot` descriptor plus the working directory to the constructor.
 * Then call `runRound(round, responses)` for each game round and `cleanup()`
 * when the match is over.
 */
export class JudgeProgramRunner {
  private readonly logger = new Logger(JudgeProgramRunner.name);
  private child: ChildProcess | null = null;
  private exited = false;
  private stderrBuffer = '';

  constructor(
    private readonly compiled: CompiledBot,
    private readonly workDir: string,
    /** Per-round timeout in milliseconds */
    private readonly timeLimitMs: number = 5000,
  ) {}

  /**
   * Start the judge process if it hasn't started yet, then execute one round.
   */
  async runRound(
    round: number,
    responses: Record<string, unknown>,
  ): Promise<JudgeRunnerRoundResult> {
    if (!this.child) {
      this.spawnProcess();
    }

    if (this.exited || !this.child) {
      return {
        commands: {},
        verdict: 'error',
        error: 'Judge process has exited unexpectedly',
      };
    }

    const inputLine = JSON.stringify({ round, responses }) + '\n';

    return new Promise<JudgeRunnerRoundResult>((resolve) => {
      let buffer = '';
      let settled = false;

      const settle = (result: JudgeRunnerRoundResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        this.child?.stdout?.off('data', onData);
        resolve(result);
      };

      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();

        if (buffer.length > MAX_BUFFER_SIZE) {
          this.logger.warn('Judge stdout exceeded 1 MB buffer limit — killing process');
          this.signal('SIGKILL');
          this.exited = true;
          settle({
            commands: {},
            verdict: 'error',
            error: 'Judge output exceeded size limit (OLE)',
          });
          return;
        }

        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          settle(this.parseLine(line));
        }
      };

      const timeoutHandle = setTimeout(() => {
        this.logger.warn(`Judge timed out after ${this.timeLimitMs}ms`);
        this.signal('SIGKILL');
        this.exited = true;
        settle({
          commands: {},
          verdict: 'error',
          error: `Judge TLE: exceeded ${this.timeLimitMs}ms`,
        });
      }, this.timeLimitMs);

      if (this.exited || !this.child) {
        settle({ commands: {}, verdict: 'error', error: 'Judge process has exited' });
        return;
      }

      this.child.stdout?.on('data', onData);

      try {
        this.child.stdin?.write(inputLine);
      } catch {
        settle({ commands: {}, verdict: 'error', error: 'EPIPE: cannot write to judge stdin' });
      }
    }).then((result) => {
      // Attach any stderr collected since the last round
      const capturedStderr = this.stderrBuffer.trim();
      this.stderrBuffer = '';
      return capturedStderr ? { ...result, stderr: capturedStderr } : result;
    });
  }

  /** Kill the judge process and free resources */
  async cleanup(): Promise<void> {
    if (this.child && !this.exited) {
      this.signal('SIGKILL');
    }
    this.child = null;
    this.exited = false;
    this.stderrBuffer = '';
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private spawnProcess(): void {
    this.child = spawn(this.compiled.cmd, this.compiled.args, {
      cwd: this.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = false;

    this.child.on('exit', (code) => {
      this.exited = true;
      this.logger.debug(`Judge process exited (code=${code})`);
    });

    this.child.on('error', (err) => {
      this.exited = true;
      this.logger.error(`Judge process failed to start: ${err.message}`);
    });

    this.child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return;
      this.exited = true;
      this.logger.error(`Judge stdin error: ${err.message}`);
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
      // Cap stderr buffer at 64 KB
      if (this.stderrBuffer.length > 65536) {
        this.stderrBuffer = this.stderrBuffer.slice(-65536);
      }
    });

    // Prevent unhandled stream errors
    this.child.stdout?.on('error', () => {});
    this.child.stderr?.on('error', () => {});
  }

  private signal(sig: NodeJS.Signals): void {
    try {
      this.child?.kill(sig);
    } catch {
      this.logger.debug(`Failed to send ${sig} to judge process — it may have already exited`);
    }
  }

  private parseLine(line: string): JudgeRunnerRoundResult {
    if (!line) {
      return { commands: {}, verdict: 'error', error: 'Judge produced empty output' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return {
        commands: {},
        verdict: 'error',
        error: `Judge output is not valid JSON: ${line.slice(0, 200)}`,
      };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        commands: {},
        verdict: 'error',
        error: `Judge output must be a JSON object, got: ${line.slice(0, 200)}`,
      };
    }

    const obj = parsed as Record<string, unknown>;

    const verdict = obj.verdict;
    if (verdict !== 'continue' && verdict !== 'finish') {
      return {
        commands: {},
        verdict: 'error',
        error: `Judge returned unknown verdict: "${String(verdict)}"`,
      };
    }

    const commands =
      typeof obj.commands === 'object' && obj.commands !== null && !Array.isArray(obj.commands)
        ? (obj.commands as Record<string, unknown>)
        : {};

    const result: JudgeRunnerRoundResult = {
      commands,
      display: obj.display,
      verdict,
      debug: typeof obj.debug === 'string' ? obj.debug : undefined,
    };

    if (verdict === 'finish') {
      const rawScores = obj.scores;
      if (typeof rawScores === 'object' && rawScores !== null && !Array.isArray(rawScores)) {
        const scores: Record<string, number> = {};
        for (const [id, val] of Object.entries(rawScores as Record<string, unknown>)) {
          scores[id] = typeof val === 'number' && isFinite(val) ? val : 0;
        }
        result.scores = scores;
      }
    }

    return result;
  }
}
