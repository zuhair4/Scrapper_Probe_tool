interface HostState {
  inFlight: boolean;
  queue: Array<() => void>;
  lastRequestTime: number;
}

const hostMap = new Map<string, HostState>();

export function acquireHostLock(host: string, delayMs: number): Promise<() => void> {
  if (!hostMap.has(host)) {
    hostMap.set(host, { inFlight: false, queue: [], lastRequestTime: 0 });
  }

  const state = hostMap.get(host)!;

  return new Promise<() => void>((resolve) => {
    const tryAcquire = () => {
      if (!state.inFlight) {
        state.inFlight = true;
        const elapsed = Date.now() - state.lastRequestTime;
        const wait = Math.max(0, delayMs - elapsed);

        setTimeout(() => {
          const release = () => {
            state.lastRequestTime = Date.now();
            state.inFlight = false;
            const next = state.queue.shift();
            if (next) setTimeout(next, 0);
          };
          resolve(release);
        }, wait);
      } else {
        state.queue.push(tryAcquire);
      }
    };

    tryAcquire();
  });
}
