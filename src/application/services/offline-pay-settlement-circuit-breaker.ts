export interface OfflinePaySettlementCircuitState {
  open: boolean;
  consecutiveFailures: number;
  openUntilMs?: number;
  cooldownRemainingMs: number;
}

type OfflinePaySettlementCircuitBreakerOptions = {
  failureThreshold: number;
  openCooldownMs: number;
};

const DEFAULT_OPTIONS: OfflinePaySettlementCircuitBreakerOptions = {
  failureThreshold: 3,
  openCooldownMs: 5 * 60 * 1000
};

export class OfflinePaySettlementCircuitBreaker {
  private consecutiveFailures = 0;
  private openUntilMs?: number;

  constructor(private readonly options: OfflinePaySettlementCircuitBreakerOptions = DEFAULT_OPTIONS) {}

  canExecute(nowMs = Date.now()) {
    return !this.isOpen(nowMs);
  }

  recordSuccess() {
    const wasOpen = Boolean(this.openUntilMs);
    this.consecutiveFailures = 0;
    this.openUntilMs = undefined;
    return wasOpen;
  }

  recordFailure(nowMs = Date.now()) {
    this.consecutiveFailures = Math.min(this.consecutiveFailures + 1, Number.MAX_SAFE_INTEGER);
    const opened = this.consecutiveFailures >= this.options.failureThreshold;
    if (opened) {
      this.openUntilMs = nowMs + this.options.openCooldownMs;
    }

    return {
      opened,
      state: this.snapshot(nowMs)
    };
  }

  snapshot(nowMs = Date.now()): OfflinePaySettlementCircuitState {
    return {
      open: this.isOpen(nowMs),
      consecutiveFailures: this.consecutiveFailures,
      openUntilMs: this.openUntilMs,
      cooldownRemainingMs: this.openUntilMs ? Math.max(0, this.openUntilMs - nowMs) : 0
    };
  }

  private isOpen(nowMs: number) {
    return this.openUntilMs !== undefined && nowMs < this.openUntilMs;
  }
}
