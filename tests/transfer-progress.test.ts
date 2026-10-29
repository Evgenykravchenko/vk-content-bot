import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProgressReporter,
  trackedDownload,
  TransferProgress,
} from '../src/services/transfer-progress.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('adaptive transfer estimates', () => {
  it('uses file size and measured speed, adapts to slowdown and hides stalled estimates', () => {
    let now = 0;
    const progress = new TransferProgress(10_000, () => now);
    expect(progress.snapshot().etaSeconds).toBeNull();
    progress.add(1000);
    now = 2000;
    progress.add(1000);
    const first = progress.snapshot();
    expect(first.bytesPerSecond).toBe(1000);
    expect(first.etaSeconds).toBe(8);
    now = 4000;
    progress.add(200);
    expect(progress.snapshot().bytesPerSecond).toBeLessThan(first.bytesPerSecond!);
    expect(progress.snapshot().etaSeconds).toBeGreaterThan(first.etaSeconds!);
    now = 11_000;
    expect(progress.snapshot().etaSeconds).toBeNull();
    expect(progress.snapshot().bytesPerSecond).toBeNull();
  });

  it('never invents an estimate for a tiny, unknown-size or finalizing file', () => {
    const small = new TransferProgress(4, () => 0);
    small.add(4);
    small.finishTransfer();
    expect(small.snapshot()).toMatchObject({
      stage: 'finalizing',
      etaSeconds: null,
      transferredBytes: 4,
    });
    const unknown = new TransferProgress(null);
    unknown.add(5);
    expect(unknown.snapshot().etaSeconds).toBeNull();
    expect(() => new TransferProgress(4).finishTransfer()).toThrow('ended early');
  });
});

it('coalesces slow progress writes and drains them before the terminal status', async () => {
  vi.useFakeTimers();
  const tracker = new TransferProgress(1000);
  let release: (() => void) | undefined;
  const report = vi
    .fn<(progress: ReturnType<TransferProgress['snapshot']>) => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const reporter = new ProgressReporter(tracker, report, vi.fn());
  reporter.start();
  await vi.advanceTimersByTimeAsync(3000);
  tracker.add(500);
  await vi.advanceTimersByTimeAsync(9000);
  expect(report).toHaveBeenCalledTimes(1);
  release!();
  await reporter.stop();
  const finalCount = report.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  reporter.flush();
  expect(report).toHaveBeenCalledTimes(finalCount);
  expect(report.mock.calls.at(-1)?.[0].transferredBytes).toBe(500);
});

it('streams the source lazily and rejects incomplete source downloads', async () => {
  const download = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
  vi.stubGlobal('fetch', download);
  const tracker = new TransferProgress(4);
  const reporter = new ProgressReporter(tracker, vi.fn().mockResolvedValue(undefined), vi.fn());
  const file = {
    href: 'https://download.example/private-test',
    name: 'file.mov',
    size: 4,
    mimeType: 'video/quicktime',
  };
  const source = trackedDownload(file, tracker, reporter, 5000);
  expect(download).not.toHaveBeenCalled();
  const chunks = [];
  for await (const chunk of source) chunks.push(chunk as Buffer);
  await reporter.stop();
  expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
  expect(tracker.snapshot().stage).toBe('finalizing');
  const truncated = trackedDownload({ ...file, size: 8 }, new TransferProgress(8), reporter, 5000);
  // A fresh body simulates a server that closes before its declared byte count.
  download.mockResolvedValueOnce(new Response(new Uint8Array([1])));
  await expect(Readable.from(truncated).toArray()).rejects.toThrow('ended early');
});
