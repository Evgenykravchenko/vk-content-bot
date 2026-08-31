const punctuationPattern = /[^\p{L}\p{N}\s-]/gu;
const whitespacePattern = /\s+/g;

export function normalizeText(value: string): string {
  return value
    .replaceAll('№', ' ')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(punctuationPattern, ' ')
    .replace(whitespacePattern, ' ')
    .trim();
}

export function splitWords(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized.length === 0 ? [] : normalized.split(' ');
}
