/**
 * IStrategy — game judge interface
 *
 * Abstracts the per-round communication with a judge (built-in or user-submitted).
 * Implementations receive aggregated bot responses each round and return the next
 * set of commands plus a verdict.
 *
 * Zero NestJS/infrastructure dependencies; pure domain interface.
 */

/** Output produced by the judge for one round */
export interface JudgeRoundOutput {
  /** Commands to send to each bot, keyed by bot id */
  commands: Record<string, unknown>;
  /** Display/visualization payload (forwarded to frontend) */
  display?: unknown;
  /** Game status after this round */
  verdict: 'continue' | 'finish' | 'error';
  /** Final scores, populated when verdict === 'finish' */
  scores?: Record<string, number>;
  /** Debug message emitted by the judge program */
  debug?: string;
  /** Stderr output collected from the judge process */
  stderr?: string;
  /** Error detail when verdict === 'error' */
  error?: string;
}

/**
 * Game strategy interface
 *
 * The judge is a long-lived object across rounds.
 * On the first call, `responses` is an empty object (game initialisation).
 * On subsequent calls, `responses` carries each bot's move from the previous round.
 */
export interface IStrategy {
  /**
   * Advance the game by one round.
   *
   * @param responses  Bot responses from the previous round.
   *                   Empty object on the very first call.
   */
  nextRound(responses: Record<string, unknown>): Promise<JudgeRoundOutput>;

  /** Release all resources (kill the judge process, free memory, etc.) */
  cleanup(): Promise<void>;
}
