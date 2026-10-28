import { findBestRule } from '../domain/matcher.js';
import type { FallbackContent, KeywordRule, PreparedResponse } from '../domain/types.js';
import type { Logger } from '../config/logger.js';
import type { ContentClient } from './botcrm-content-client.js';

interface RuleCache {
  rules: KeywordRule[];
  expiresAt: number;
}

export class ContentService {
  private cache: RuleCache = { rules: [], expiresAt: 0 };
  private refreshPromise: Promise<KeywordRule[]> | null = null;

  constructor(
    private readonly contentClient: ContentClient,
    private readonly cacheTtlMs: number,
    private readonly logger: Logger,
  ) {}

  async findResponse(message: string): Promise<PreparedResponse | null> {
    const rules = await this.getRules();
    const rule = findBestRule(message, rules);
    if (!rule) return null;

    this.logger.debug({ ruleId: rule.id, responseId: rule.response }, 'Keyword rule matched');
    return this.contentClient.getPreparedResponse(rule.response);
  }

  async getFallbackContent(): Promise<FallbackContent> {
    const settings = await this.contentClient.getBotSettings();
    const fallbackResponseId = settings?.fallback_response;
    const fallbackMessage = settings?.unknown_message?.trim() || null;

    if (fallbackResponseId) {
      const response = await this.contentClient.getPreparedResponse(fallbackResponseId);
      if (response) return { response, message: fallbackMessage };
    }

    return {
      response: null,
      message: fallbackMessage,
    };
  }

  invalidate(): void {
    this.cache.expiresAt = 0;
  }

  private async getRules(): Promise<KeywordRule[]> {
    if (Date.now() < this.cache.expiresAt) {
      return this.cache.rules;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.contentClient
        .getRules()
        .then((rules) => {
          this.cache = { rules, expiresAt: Date.now() + this.cacheTtlMs };
          this.logger.info({ count: rules.length }, 'Keyword rules cache refreshed');
          return rules;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }
}
