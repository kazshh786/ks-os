/** Bound both response latency and outstanding work if the evidence database stalls. */
export class EvidenceBudget {
  private inFlight = 0;
  constructor(private readonly maximumInFlight = 8, private readonly timeoutMs = 250) {}

  async run(work: () => Promise<unknown>): Promise<'saved' | 'failed' | 'timeout' | 'saturated'> {
    if (this.inFlight >= this.maximumInFlight) return 'saturated';
    this.inFlight += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(work).then(
      () => 'saved' as const, () => 'failed' as const,
    ).finally(() => { this.inFlight -= 1; });
    try {
      return await Promise.race([
        pending,
        new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), this.timeoutMs); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
