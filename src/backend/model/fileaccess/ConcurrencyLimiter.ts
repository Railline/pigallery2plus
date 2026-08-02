export class ConcurrencyLimitQueueFullError extends Error {
  constructor() {
    super('Concurrency limiter queue is full');
  }
}

export class ConcurrencyLimitAbortedError extends Error {
  constructor() {
    super('Queued operation was aborted');
  }
}

interface PendingOperation {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** A small FIFO semaphore with abort and bounded-queue support. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly pending: PendingOperation[] = [];

  constructor(
    private readonly getLimit: () => number,
    private readonly maxQueue = 256
  ) {
  }

  public get Active(): number {
    return this.active;
  }

  public get Pending(): number {
    return this.pending.length;
  }

  public acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new ConcurrencyLimitAbortedError());
    }

    if (this.active < this.limit()) {
      this.active++;
      return Promise.resolve(this.createRelease());
    }

    if (this.pending.length >= this.maxQueue) {
      return Promise.reject(new ConcurrencyLimitQueueFullError());
    }

    return new Promise<() => void>((resolve, reject): void => {
      const operation: PendingOperation = {resolve, reject, signal};
      operation.onAbort = (): void => {
        const index = this.pending.indexOf(operation);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        reject(new ConcurrencyLimitAbortedError());
      };
      signal?.addEventListener('abort', operation.onAbort, {once: true});
      this.pending.push(operation);
    });
  }

  private limit(): number {
    const configured = Math.floor(this.getLimit());
    return Number.isFinite(configured) && configured > 0 ? configured : 1;
  }

  private createRelease(): () => void {
    let released = false;
    return (): void => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  private drain(): void {
    while (this.pending.length > 0 && this.active < this.limit()) {
      const operation = this.pending.shift();
      operation.signal?.removeEventListener('abort', operation.onAbort);
      if (operation.signal?.aborted) {
        operation.reject(new ConcurrencyLimitAbortedError());
        continue;
      }
      this.active++;
      operation.resolve(this.createRelease());
    }
  }
}
