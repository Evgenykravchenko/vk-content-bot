import { Keyboard } from 'vk-io';
import type { ResponseButton } from './types.js';

const MAX_INLINE_ROWS = 6;
const MAX_TEXT_BUTTONS_PER_ROW = 5;
const MAX_LABEL_LENGTH = 40;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validButton(button: ResponseButton): boolean {
  const label = button.label.trim();
  const target = button.target.trim();
  if (!button.enabled || !label || label.length > MAX_LABEL_LENGTH || !target) return false;
  return button.action === 'text' || isHttpUrl(target);
}

export function buildResponseKeyboard(buttons: ResponseButton[]): string | undefined {
  const builder = Keyboard.builder().inline();
  const sorted = buttons
    .filter(validButton)
    .toSorted((left, right) => left.row_number - right.row_number || left.sort - right.sort);

  let activeRow: number | null = null;
  let textButtonsInRow = 0;
  let completedRows = 0;
  let addedButtons = 0;

  const flushTextRow = () => {
    if (textButtonsInRow === 0) return;
    builder.row();
    completedRows += 1;
    textButtonsInRow = 0;
  };

  for (const button of sorted) {
    if (activeRow !== null && button.row_number !== activeRow) {
      flushTextRow();
    }
    activeRow = button.row_number;

    if (completedRows >= MAX_INLINE_ROWS) break;

    if (button.action === 'open_link') {
      flushTextRow();
      if (completedRows >= MAX_INLINE_ROWS) break;
      builder.urlButton({ label: button.label.trim(), url: button.target.trim() });
      completedRows += 1;
      addedButtons += 1;
      continue;
    }

    if (textButtonsInRow === MAX_TEXT_BUTTONS_PER_ROW) {
      flushTextRow();
      if (completedRows >= MAX_INLINE_ROWS) break;
    }

    builder.textButton({
      label: button.label.trim(),
      payload: { keyword: button.target.trim() },
      color: button.color,
    });
    textButtonsInRow += 1;
    addedButtons += 1;
  }

  flushTextRow();
  return addedButtons > 0 ? builder.toString() : undefined;
}

export function keywordFromButtonPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('keyword' in payload)) return null;
  const keyword = (payload as { keyword?: unknown }).keyword;
  return typeof keyword === 'string' && keyword.trim() ? keyword.trim() : null;
}
