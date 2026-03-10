/**
 * WebhookRunner — HTTP POST dispatcher for webhook-type bots
 *
 * Instead of running sandboxed code, sends BotInput as a JSON POST to an
 * external URL and treats the response body as the bot's output string.
 *
 * Timeout: configurable, default 10 s, clamped to 30 s max.
 * Any failure (timeout, non-2xx, network error) returns an empty string,
 * matching the behaviour of a sandboxed bot that crashes or TLEs.
 */

import { Logger } from '@nestjs/common';
import { BotInput, BotOutput } from '../../domain/bot';

export const WEBHOOK_DEFAULT_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_TIMEOUT_MS = 360_000; // 6 min for human turns

export class WebhookRunner {
  private readonly logger = new Logger(WebhookRunner.name);

  /**
   * Call the webhook URL with BotInput and return the bot's output.
   *
   * @param botId     Bot identifier (for logging)
   * @param externalUrl  POST target
   * @param input     Full BotInput payload
   * @param timeoutMs Request timeout in milliseconds (default 10 s, max 30 s)
   */
  async run(
    botId: string,
    externalUrl: string,
    input: BotInput,
    timeoutMs: number = WEBHOOK_DEFAULT_TIMEOUT_MS,
  ): Promise<BotOutput> {
    const clampedTimeout = Math.min(Math.max(timeoutMs, 1), WEBHOOK_MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), clampedTimeout);

    try {
      const response = await fetch(externalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook bot ${botId} returned non-2xx status: ${response.status} ${response.statusText}`,
        );
        return { response: '' };
      }

      const text = await response.text();
      return { response: text.trim() };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.warn(`Webhook bot ${botId} timed out after ${clampedTimeout}ms`);
      } else {
        this.logger.error(`Webhook bot ${botId} connection error: ${err}`);
      }
      return { response: '' };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
