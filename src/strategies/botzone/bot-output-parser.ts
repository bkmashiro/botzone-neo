/**
 * Bot output parser for the new judge protocol
 *
 * Simple bots output a raw value to stdout (number or string).
 * Enhanced bots can output a JSON object with `move` and `debug` fields.
 *
 * Rules:
 *   - Line does NOT start with `{` → raw move value
 *     - If it looks like a number → return as number
 *     - Otherwise → return as string
 *   - Line starts with `{` → parse as JSON
 *     - On success: extract `move` field (required) and optional `debug`
 *     - On failure: throw BotOutputParseError
 *
 * stderr (from the bot process) is always collected as additional debug info.
 */

/** Thrown when a bot outputs JSON that cannot be parsed */
export class BotOutputParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotOutputParseError';
  }
}

export interface BotMoveResult {
  /** The actual move value (number, string, or any JSON value) */
  move: unknown;
  /** Debug message optionally embedded in the bot's JSON output */
  debug?: string;
}

/**
 * Parse bot stdout into a move result.
 *
 * @param stdout  Full stdout from the bot process (trimmed to first line)
 * @param stderr  Full stderr from the bot process (collected as additional debug)
 */
export function parseBotOutput(stdout: string, stderr: string): BotMoveResult {
  const line = stdout.trim().split('\n')[0]?.trim() ?? '';

  if (line.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new BotOutputParseError(`Invalid JSON from bot: ${line.slice(0, 200)}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BotOutputParseError(
        `Bot JSON output must be an object, got: ${line.slice(0, 200)}`,
      );
    }

    const obj = parsed as Record<string, unknown>;

    // `move` is the canonical field; fall back to the whole object for convenience
    const move = 'move' in obj ? obj.move : obj;
    const debug = typeof obj.debug === 'string' ? obj.debug : undefined;

    return { move, debug };
  }

  // Raw value: prefer number, fall back to string
  if (line === '') {
    return { move: line, debug: stderr.trim() || undefined };
  }

  const num = Number(line);
  const move = isNaN(num) ? line : num;

  return { move, debug: stderr.trim() || undefined };
}
