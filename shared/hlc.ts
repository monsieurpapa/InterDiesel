// Hybrid logical clock. Produces string timestamps that sort correctly even
// when phone clocks are wrong: each clock never goes backwards and it moves
// forward past any timestamp it has seen from the server.
// Format: 13-digit ms : 5-digit counter : node id  (string comparable)

export class HLC {
  private last = 0;
  private counter = 0;
  constructor(
    private node: string,
    private now: () => number = () => Date.now(),
  ) {}

  /** Offset in ms to add to the local clock (learned from the server). */
  offset = 0;

  tick(): string {
    const phys = this.now() + this.offset;
    if (phys > this.last) {
      this.last = phys;
      this.counter = 0;
    } else {
      this.counter++;
      // keep the fixed 5-digit format: borrow a millisecond instead of overflowing
      if (this.counter > 99_999) {
        this.last++;
        this.counter = 0;
      }
    }
    return format(this.last, this.counter, this.node);
  }

  /** Move forward past a timestamp received from elsewhere. */
  observe(remote: string) {
    const r = parse(remote);
    if (!r) return;
    if (r.ms > this.last) {
      this.last = r.ms;
      this.counter = r.counter;
    } else if (r.ms === this.last && r.counter > this.counter) {
      this.counter = r.counter;
    }
  }
}

export function format(ms: number, counter: number, node: string): string {
  return `${String(Math.max(0, Math.floor(ms))).padStart(13, '0')}:${String(counter).padStart(5, '0')}:${node}`;
}

export function parse(h: string): { ms: number; counter: number; node: string } | null {
  const m = /^(\d{13}):(\d{5}):(.+)$/.exec(h);
  if (!m) return null;
  return { ms: Number(m[1]), counter: Number(m[2]), node: m[3] };
}

export function isHlc(h: unknown): h is string {
  return typeof h === 'string' && parse(h) !== null;
}
