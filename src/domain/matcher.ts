import type { KeywordRule } from './types.js';
import { normalizeText, splitWords } from './text.js';

function matchesRule(normalizedMessage: string, rule: KeywordRule): boolean {
  const normalizedPhrase = normalizeText(rule.phrase);

  if (normalizedMessage.length === 0 || normalizedPhrase.length === 0) {
    return false;
  }

  switch (rule.match_mode) {
    case 'exact':
      return normalizedMessage === normalizedPhrase;
    case 'contains':
      return normalizedMessage.includes(normalizedPhrase);
    case 'any_word': {
      const messageWords = new Set(splitWords(normalizedMessage));
      return splitWords(normalizedPhrase).some((word) => messageWords.has(word));
    }
    case 'all_words': {
      const messageWords = new Set(splitWords(normalizedMessage));
      return splitWords(normalizedPhrase).every((word) => messageWords.has(word));
    }
  }
}

export function findBestRule(message: string, rules: KeywordRule[]): KeywordRule | undefined {
  const normalizedMessage = normalizeText(message);

  return rules
    .filter((rule) => rule.enabled && matchesRule(normalizedMessage, rule))
    .sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      return normalizeText(right.phrase).length - normalizeText(left.phrase).length;
    })[0];
}
