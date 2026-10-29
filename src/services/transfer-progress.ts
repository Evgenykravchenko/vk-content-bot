import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DownloadableFile } from './yandex-disk-client.js';

import type { PreparationProgress } from '../domain/types.js';
export type { PreparationProgress } from '../domain/types.js';

export class TransferProgress {
  readonly attemptId = randomUUID();
  private stage: PreparationProgress['stage'] = 'connecting';
  private bytes = 0;
  private firstByteAt: number | undefined;
  private lastByteAt = 0;
  private sampledAt: number;
  private sampledBytes = 0;
  private speed: number | undefined;

  constructor(
    private total: number | null,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.sampledAt = now();
    this.total =
      total !== null && Number.isSafeInteger(Number(total)) && Number(total) > 0
        ? Number(total)
        : null;
  }

  setTotal(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid source file size');
    this.total = bytes;
  }

  add(bytes: number): void {
    if (this.firstByteAt === undefined) {
      this.firstByteAt = this.now();
      this.sampledAt = this.firstByteAt;
      this.sampledBytes = this.bytes;
      this.speed = undefined;
    }
    this.lastByteAt = this.now();
    this.stage = 'transferring';
    this.bytes += bytes;
    if (this.total !== null && this.bytes > this.total)
      throw new Error('Source file size changed during transfer');
  }

  finishTransfer(): void {
    if (this.total !== null && this.bytes !== this.total)
      throw new Error('Source file transfer ended early');
    this.stage = 'finalizing';
  }

  snapshot(): PreparationProgress {
    const now = this.now();
    const elapsed = now - this.sampledAt;
    if (elapsed >= 500) {
      const currentSpeed = ((this.bytes - this.sampledBytes) * 1_000) / elapsed;
      this.speed = this.speed === undefined ? currentSpeed : this.speed * 0.6 + currentSpeed * 0.4;
      this.sampledAt = now;
      this.sampledBytes = this.bytes;
    }
    const measuring =
      this.stage === 'transferring' &&
      this.firstByteAt !== undefined &&
      now - this.firstByteAt >= 1_500 &&
      now - this.lastByteAt < 6_000;
    const speed = measuring && this.speed && this.speed > 0 ? Math.round(this.speed) : null;
    const remaining = speed && this.total ? Math.ceil((this.total - this.bytes) / speed) : null;
    return {
      attemptId: this.attemptId,
      stage: this.stage,
      transferredBytes: this.bytes,
      totalBytes: this.total,
      bytesPerSecond: speed,
      etaSeconds: remaining !== null && remaining <= 604_800 ? Math.max(0, remaining) : null,
    };
  }
}

// One in-flight update, coalesced snapshots and a three-second cadence keep telemetry
// independent of stream chunk sizes and prevent slow CRM requests from buffering the file.
export class ProgressReporter {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = false;

  constructor(
    private readonly tracker: TransferProgress,
    private readonly report: (progress: PreparationProgress) => Promise<unknown>,
    private readonly warn: () => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.flush(), 3_000);
    this.timer.unref();
  }

  flush(): void {
    if (this.stopped) return;
    this.pending = true;
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      try {
        await this.report(this.tracker.snapshot());
      } catch {
        this.warn();
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.stopped = true;
    // No progress writes may arrive after the terminal ready/error update.
    await this.running;
  }
}

export function trackedDownload(
  file: DownloadableFile,
  tracker: TransferProgress,
  reporter: ProgressReporter,
  timeout: number,
): Readable {
  return Readable.from(
    (async function* () {
      const controller = new AbortController();
      try {
        const response = await fetch(file.href, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
        });
        if (!response.ok || !response.body)
          throw new Error(`Source download failed (${response.status})`);
        const reader = response.body.getReader();
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            const chunk: unknown = result.value;
            if (!(chunk instanceof Uint8Array)) throw new Error('Invalid download chunk');
            tracker.add(chunk.byteLength);
            yield chunk;
          }
          tracker.finishTransfer();
          reporter.flush();
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      } finally {
        controller.abort();
      }
    })(),
  );
}
