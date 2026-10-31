/** Leading-edge gate: act immediately; no delayed/trailing action can hit a new card. */
export class ActionGate {
  private lockedUntil = -Infinity;
  private running = false;
  constructor(private readonly interval = 300, private readonly clock = () => performance.now()) {}
  get pending() { return this.running; }
  resetCooldown() { if (!this.running) this.lockedUntil = -Infinity; }
  async run(action: () => Promise<unknown>): Promise<boolean> {
    const now = this.clock();
    if (this.running || now < this.lockedUntil) return false;
    this.running = true;
    this.lockedUntil = now + this.interval;
    try { await action(); return true; }
    catch (error) { this.lockedUntil = -Infinity; throw error; }
    finally { this.running = false; }
  }
}

/** Separate cooldown per intent, but only one task transition may be in flight. */
export class KeyedActionGate {
  private running = false;
  private readonly gates = new Map<string, ActionGate>();
  constructor(private readonly interval = 300, private readonly clock = () => performance.now()) {}
  async run(key: string, action: () => Promise<unknown>): Promise<boolean> {
    if (this.running) return false;
    let gate = this.gates.get(key);
    if (!gate) {
      if (this.gates.size >= 32) this.gates.delete(this.gates.keys().next().value!);
      gate = new ActionGate(this.interval, this.clock);
      this.gates.set(key, gate);
    }
    this.running = true;
    try { return await gate.run(action); }
    finally { this.running = false; }
  }
}
