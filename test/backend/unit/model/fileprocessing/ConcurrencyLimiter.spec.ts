import {expect} from 'chai';
import {
  ConcurrencyLimitAbortedError,
  ConcurrencyLimiter,
  ConcurrencyLimitQueueFullError
} from '../../../../../src/backend/model/fileaccess/ConcurrencyLimiter';

describe('ConcurrencyLimiter', () => {
  it('runs queued operations in FIFO order at the configured limit', async () => {
    const limiter = new ConcurrencyLimiter(() => 2);
    const releaseFirst = await limiter.acquire();
    const releaseSecond = await limiter.acquire();
    let thirdStarted = false;
    const third = limiter.acquire().then((release) => {
      thirdStarted = true;
      return release;
    });

    await Promise.resolve();
    expect(thirdStarted).to.equal(false);
    expect(limiter.Active).to.equal(2);
    expect(limiter.Pending).to.equal(1);

    releaseFirst();
    const releaseThird = await third;
    expect(thirdStarted).to.equal(true);
    expect(limiter.Active).to.equal(2);
    expect(limiter.Pending).to.equal(0);

    releaseSecond();
    releaseThird();
    expect(limiter.Active).to.equal(0);
  });

  it('removes an aborted operation from the queue', async () => {
    const limiter = new ConcurrencyLimiter(() => 1);
    const release = await limiter.acquire();
    const controller = new AbortController();
    const queued = limiter.acquire(controller.signal);
    controller.abort();

    let error: Error;
    try {
      await queued;
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).to.be.instanceOf(ConcurrencyLimitAbortedError);
    expect(limiter.Pending).to.equal(0);
    release();
  });

  it('rejects excess queued operations', async () => {
    const limiter = new ConcurrencyLimiter(() => 1, 1);
    const release = await limiter.acquire();
    const queued = limiter.acquire();

    let error: Error;
    try {
      await limiter.acquire();
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).to.be.instanceOf(ConcurrencyLimitQueueFullError);

    release();
    const releaseQueued = await queued;
    releaseQueued();
  });
});
