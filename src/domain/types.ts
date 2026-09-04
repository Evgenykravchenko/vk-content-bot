export const MATCH_MODES = ['exact', 'contains', 'any_word', 'all_words'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const BLOCK_KINDS = ['text', 'photo', 'video', 'audio', 'document'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const MEDIA_KINDS = ['photo', 'video', 'audio', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ['draft', 'queued', 'processing', 'ready', 'error'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const BUTTON_ACTIONS = ['text', 'open_link'] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export const BUTTON_COLORS = ['primary', 'secondary', 'positive', 'negative'] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export interface KeywordRule {
  id: number;
  phrase: string;
  match_mode: MatchMode;
  priority: number;
  response: number;
  enabled: boolean;
}

export interface ContentResponse {
  id: number;
  name: string;
  status: 'draft' | 'published';
  fallback_text: string | null;
}

export interface BotSettings {
  unknown_message: string | null;
  fallback_response: number | null;
}

export interface FallbackContent {
  response: PreparedResponse | null;
  message: string | null;
}

export interface MediaAsset {
  id: number;
  name: string;
  kind: MediaKind;
  yandex_path: string;
  status: MediaStatus;
  vk_attachment: string | null;
  mime_type: string | null;
  file_size: number | null;
  error_message: string | null;
}

export interface ResponseBlock {
  id: number;
  response: number;
  sort: number;
  kind: BlockKind;
  body: string | null;
  media: number | MediaAsset | null;
  send_separately: boolean;
  enabled: boolean;
}

export interface ResponseButton {
  id: number;
  response: number;
  label: string;
  action: ButtonAction;
  target: string;
  color: ButtonColor;
  row_number: number;
  sort: number;
  enabled: boolean;
}

export interface PreparedResponse {
  response: ContentResponse;
  blocks: ResponseBlock[];
  buttons: ResponseButton[];
}

export interface OutboundMessage {
  message?: string;
  attachment?: string[];
  keyboard?: string;
}
