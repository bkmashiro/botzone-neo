/**
 * StrategyFactory
 *
 * Creates the appropriate IStrategy for a given judger specification.
 *
 * Routing logic:
 *   judger.source (non-empty) → UserJudgeStrategy (user-submitted judge program)
 *   judger.name               → built-in strategy lookup (backward compat)
 *   otherwise                 → throws an error
 *
 * Built-in strategies backed by Python scripts are stored in
 * src/infrastructure/judge-runner/builtin-judges/ for documentation; in
 * production they will be loaded from the database via seeds/migrations.
 */

import { Logger } from '@nestjs/common';
import { IStrategy } from '../interfaces/strategy.interface';
import { UserJudgeStrategy } from './user-judge.strategy';
import { JudgeProgramRunner } from '../../infrastructure/judge-runner/judge-program.runner';
import { CompileService } from '../../infrastructure/compile/compile.service';

const factoryLogger = new Logger('StrategyFactory');

/** Judger specification as found in a MatchTask */
export interface JudgerSpec {
  /** User-submitted judge source code (takes priority over name) */
  source?: string;
  /** Language of the user-submitted source */
  language?: string;
  /** Per-round time limit for the judge process (ms) */
  timeLimitMs?: number;
  /** Built-in strategy name (backward compat, used when source is absent) */
  name?: string;
}

/**
 * Create an IStrategy for the given judger spec.
 *
 * @param spec          Judger specification from the task
 * @param compileService Compile service instance (for compilation cache + DI compat)
 * @param workDir       Working directory where the judge binary / script will run
 */
export async function createStrategy(
  spec: JudgerSpec,
  compileService: CompileService,
  workDir: string,
): Promise<IStrategy> {
  if (spec.source && spec.source.trim().length > 0) {
    const language = spec.language ?? 'python';
    factoryLogger.debug(`Creating UserJudgeStrategy for language=${language}`);

    const compiled = await compileService.compile(language, spec.source);
    const runner = new JudgeProgramRunner(compiled, workDir, spec.timeLimitMs ?? 5000);
    return new UserJudgeStrategy(runner);
  }

  if (spec.name) {
    // Built-in strategy by name.
    // In production the source is loaded from DB; throw here so the gap is visible.
    throw new Error(
      `Built-in strategy "${spec.name}" is not yet registered. ` +
        `Load its Python source from the database and pass it as judger.source.`,
    );
  }

  throw new Error(
    'Invalid judger spec: provide either judger.source (user-submitted program) or judger.name (built-in game).',
  );
}
