/**
 * UserJudgeStrategy
 *
 * Implements IStrategy by delegating to a JudgeProgramRunner.
 * The runner manages a long-lived judge subprocess; this class wraps it with
 * round-counting and IStrategy-compatible input/output transformation.
 *
 * Round 1: sends {"round": 1, "responses": {}}  (game init, no prior moves)
 * Round N: sends {"round": N, "responses": <botResponses>}
 */

import { Logger } from '@nestjs/common';
import { IStrategy, JudgeRoundOutput } from '../interfaces/strategy.interface';
import { JudgeProgramRunner } from '../../infrastructure/judge-runner/judge-program.runner';

export class UserJudgeStrategy implements IStrategy {
  private readonly logger = new Logger(UserJudgeStrategy.name);
  private round = 0;

  constructor(private readonly runner: JudgeProgramRunner) {}

  async nextRound(responses: Record<string, unknown>): Promise<JudgeRoundOutput> {
    this.round += 1;

    // First round always sends empty responses (game initialisation)
    const effectiveResponses = this.round === 1 ? {} : responses;

    this.logger.debug(`UserJudgeStrategy: round=${this.round}`);

    const result = await this.runner.runRound(this.round, effectiveResponses);

    // Map runner result → IStrategy output
    const output: JudgeRoundOutput = {
      commands: result.commands,
      display: result.display,
      verdict: result.verdict,
      debug: result.debug,
      stderr: result.stderr,
      error: result.error,
    };

    if (result.verdict === 'finish' && result.scores) {
      output.scores = result.scores;
    }

    return output;
  }

  async cleanup(): Promise<void> {
    await this.runner.cleanup();
  }
}
