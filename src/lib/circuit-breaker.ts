/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by detecting and isolating failing subagents
 */

import { createLogger } from "./logger";

const logger = createLogger("circuit-breaker");

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close the circuit */
  resetTimeout: number;
  /** Time window in ms for counting failures */
  rollingWindowMs: number;
  /** Number of successful calls needed to close circuit from half-open */
  successThreshold: number;
  /** Optional callback when circuit opens */
  onCircuitOpen?: (name: string) => void;
  /** Optional callback when circuit closes */
  onCircuitClose?: (name: string) => void;
}

interface CircuitMetrics {
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  recentCalls: Array<{ timestamp: number; success: boolean }>;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  rollingWindowMs: 60000, // 1 minute rolling window
  successThreshold: 3,
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private metrics: CircuitMetrics = {
    failures: 0,
    successes: 0,
    consecutiveSuccesses: 0,
    lastFailureTime: 0,
    lastSuccessTime: 0,
    recentCalls: [],
  };
  private nextAttemptTime: number = 0;
  private config: CircuitBreakerConfig;

  constructor(
    private name: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.debug("Circuit breaker created", { name, config: this.config });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() < this.nextAttemptTime) {
        const error = new Error(
          `Circuit breaker is OPEN for ${this.name}. Next attempt in ${
            Math.round((this.nextAttemptTime - Date.now()) / 1000)
          }s`
        );
        logger.warn("Circuit breaker prevented call", { 
          name: this.name,
          state: this.state,
          nextAttempt: new Date(this.nextAttemptTime).toISOString(),
        });
        throw error;
      }

      // Time to try half-open
      this.transitionToHalfOpen();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    const now = Date.now();
    this.metrics.successes++;
    this.metrics.consecutiveSuccesses++;
    this.metrics.lastSuccessTime = now;
    this.recordCall(now, true);

    if (this.state === "HALF_OPEN") {
      if (this.metrics.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }

    logger.debug("Circuit breaker success", {
      name: this.name,
      state: this.state,
      consecutiveSuccesses: this.metrics.consecutiveSuccesses,
    });
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    const now = Date.now();
    this.metrics.failures++;
    this.metrics.consecutiveSuccesses = 0;
    this.metrics.lastFailureTime = now;
    this.recordCall(now, false);

    // Clean old calls from rolling window
    this.cleanOldCalls();

    // Count failures in rolling window
    const recentFailures = this.metrics.recentCalls.filter(
      (call) => !call.success
    ).length;

    if (
      this.state === "CLOSED" &&
      recentFailures >= this.config.failureThreshold
    ) {
      this.transitionToOpen();
    } else if (this.state === "HALF_OPEN") {
      this.transitionToOpen();
    }

    logger.debug("Circuit breaker failure", {
      name: this.name,
      state: this.state,
      recentFailures,
      threshold: this.config.failureThreshold,
    });
  }

  /**
   * Record a call in the rolling window
   */
  private recordCall(timestamp: number, success: boolean): void {
    this.metrics.recentCalls.push({ timestamp, success });
    this.cleanOldCalls();
  }

  /**
   * Remove calls outside the rolling window
   */
  private cleanOldCalls(): void {
    const cutoff = Date.now() - this.config.rollingWindowMs;
    this.metrics.recentCalls = this.metrics.recentCalls.filter(
      (call) => call.timestamp > cutoff
    );
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = "OPEN";
    this.nextAttemptTime = Date.now() + this.config.resetTimeout;
    
    logger.warn("Circuit breaker opened", {
      name: this.name,
      failures: this.metrics.failures,
      nextAttempt: new Date(this.nextAttemptTime).toISOString(),
    });

    this.config.onCircuitOpen?.(this.name);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = "HALF_OPEN";
    this.metrics.consecutiveSuccesses = 0;
    
    logger.info("Circuit breaker half-open", { name: this.name });
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = "CLOSED";
    this.metrics.failures = 0;
    this.metrics.consecutiveSuccesses = 0;
    
    logger.info("Circuit breaker closed", { name: this.name });

    this.config.onCircuitClose?.(this.name);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit metrics
   */
  getMetrics(): Readonly<CircuitMetrics> & { 
    state: CircuitState;
    nextAttemptTime: number;
    recentFailureRate: number;
  } {
    this.cleanOldCalls();
    const totalRecentCalls = this.metrics.recentCalls.length;
    const recentFailures = this.metrics.recentCalls.filter(
      (call) => !call.success
    ).length;
    const recentFailureRate = totalRecentCalls > 0 
      ? recentFailures / totalRecentCalls 
      : 0;

    return {
      ...this.metrics,
      state: this.state,
      nextAttemptTime: this.nextAttemptTime,
      recentFailureRate,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = "CLOSED";
    this.metrics = {
      failures: 0,
      successes: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      recentCalls: [],
    };
    this.nextAttemptTime = 0;
    
    logger.info("Circuit breaker manually reset", { name: this.name });
  }

  /**
   * Force circuit to open (for testing or emergency shutdown)
   */
  forceOpen(): void {
    this.transitionToOpen();
  }
}

/**
 * Circuit Breaker Manager for managing multiple circuit breakers
 */
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker for a specific name
   */
  getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, {
        ...this.defaultConfig,
        ...config,
      });
      this.breakers.set(name, breaker);
    }
    return this.breakers.get(name)!;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const breaker = this.getBreaker(name, config);
    return breaker.execute(fn);
  }

  /**
   * Get all circuit breakers and their states
   */
  getAllStates(): Array<{ 
    name: string; 
    state: CircuitState;
    metrics: ReturnType<CircuitBreaker['getMetrics']>;
  }> {
    const states: Array<{ 
      name: string; 
      state: CircuitState;
      metrics: ReturnType<CircuitBreaker['getMetrics']>;
    }> = [];

    for (const [name, breaker] of this.breakers.entries()) {
      states.push({
        name,
        state: breaker.getState(),
        metrics: breaker.getMetrics(),
      });
    }

    return states;
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(name: string): void {
    this.breakers.get(name)?.reset();
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    logger.info("All circuit breakers reset");
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
  } {
    let closed = 0;
    let open = 0;
    let halfOpen = 0;

    for (const breaker of this.breakers.values()) {
      const state = breaker.getState();
      if (state === "CLOSED") closed++;
      else if (state === "OPEN") open++;
      else if (state === "HALF_OPEN") halfOpen++;
    }

    return {
      total: this.breakers.size,
      closed,
      open,
      halfOpen,
    };
  }
}

// Global circuit breaker manager instance
export const circuitBreakerManager = new CircuitBreakerManager({
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  rollingWindowMs: 60000,
  successThreshold: 3,
  onCircuitOpen: (name) => {
    logger.error("Circuit breaker opened - agent disabled", { name });
  },
  onCircuitClose: (name) => {
    logger.info("Circuit breaker closed - agent re-enabled", { name });
  },
});
