export type Frame = (callback: () => void) => number;

export interface Scheduler {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
}

/**
 * One shared animation-frame pass: any number of `schedule()` calls inside a
 * tick collapse into a single layout read + write pass on the next frame.
 */
export function createScheduler(run: () => void, frame?: Frame): Scheduler {
  let scheduled = false;
  let handle: number | null = null;

  const request =
    frame ??
    ((callback: () => void) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : (setTimeout(callback, 16) as unknown as number));

  const flush = (): void => {
    scheduled = false;
    handle = null;
    run();
  };

  return {
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      handle = request(flush);
    },
    flush: () => {
      if (!scheduled) return;
      if (handle !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(handle);
      }
      flush();
    },
    cancel: () => {
      if (handle !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(handle);
      }
      scheduled = false;
      handle = null;
    },
  };
}
