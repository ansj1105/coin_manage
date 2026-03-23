export class SimpleCircuitBreaker {
  private failures = 0;
  private openedAtMs: number | null = null;

  constructor(
    private readonly name: string,
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000
  ) {}

  get state(): 'CLOSED' | 'OPEN' {
    if (this.openedAtMs === null) {
      return 'CLOSED';
    }
    if (Date.now() - this.openedAtMs >= this.cooldownMs) {
      this.openedAtMs = null;
      this.failures = 0;
      return 'CLOSED';
    }
    return 'OPEN';
  }

  assertCallable() {
    if (this.state === 'OPEN') {
      throw new Error(`${this.name} circuit is open`);
    }
  }

  onSuccess() {
    this.failures = 0;
    this.openedAtMs = null;
  }

  onFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAtMs = Date.now();
    }
  }

  get failureCount() {
    return this.failures;
  }
}
