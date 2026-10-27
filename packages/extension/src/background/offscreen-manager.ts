export interface OffscreenDocumentOptions {
  url: string;
  reasons: string[];
  justification: string;
}

export interface OffscreenApi {
  hasDocument: () => Promise<boolean>;
  createDocument: (options: OffscreenDocumentOptions) => Promise<void>;
  closeDocument: () => Promise<void>;
}

export const OFFSCREEN_IDLE_MS = 5 * 60 * 1000;
export const OFFSCREEN_CREATION: OffscreenDocumentOptions = {
  url: 'offscreen.html',
  reasons: ['USER_MEDIA'],
  justification: 'Voice input for form filling',
};

export type EnsureResult = 'existing' | 'created' | 'shared';

/**
 * Guards the well-known MV3 race: concurrent `AUDIO_START`s must create exactly
 * one offscreen document, so creation is a single in-flight promise.
 */
export class OffscreenManager {
  private creating: Promise<EnsureResult> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private creationCount = 0;

  constructor(
    private readonly api: OffscreenApi,
    private readonly options: { idleMs?: number; creation?: OffscreenDocumentOptions } = {},
  ) {}

  private get idleMs(): number {
    return this.options.idleMs ?? OFFSCREEN_IDLE_MS;
  }

  async ensure(): Promise<EnsureResult> {
    this.cancelIdleClose();
    if (this.creating) {
      await this.creating;
      return 'shared';
    }
    // Acquire the lock synchronously, before any await, or concurrent calls
    // both observe an empty slot and create two documents.
    this.creating = this.open().finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  private async open(): Promise<EnsureResult> {
    if (await this.api.hasDocument()) return 'existing';
    await this.api.createDocument(this.options.creation ?? OFFSCREEN_CREATION);
    this.creationCount += 1;
    return 'created';
  }

  scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.close();
    }, this.idleMs);
  }

  cancelIdleClose(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async close(): Promise<void> {
    this.cancelIdleClose();
    if (await this.api.hasDocument()) await this.api.closeDocument();
  }

  get documentsCreated(): number {
    return this.creationCount;
  }

  get idleScheduled(): boolean {
    return this.idleTimer !== null;
  }
}
