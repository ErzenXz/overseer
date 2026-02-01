/**
 * Resource Pool Management
 * Manages concurrent execution limits and queuing for subagents
 */

import { createLogger } from "./logger";

const logger = createLogger("resource-pool");

export interface PoolConfig {
  /** Maximum concurrent resources */
  maxConcurrent: number;
  /** Maximum queue size (0 = unlimited) */
  maxQueueSize: number;
  /** Default priority for tasks */
  defaultPriority: number;
  /** Task timeout in ms */
  taskTimeout: number;
  /** Enable priority queue */
  enablePriority: boolean;
}

export interface PoolTask<T> {
  id: string;
  name: string;
  priority: number;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  startedAt?: number;
  timeout?: NodeJS.Timeout;
}

export interface PoolMetrics {
  total: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  timedOut: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  maxWaitTime: number;
  maxExecutionTime: number;
}

const DEFAULT_CONFIG: PoolConfig = {
  maxConcurrent: 5,
  maxQueueSize: 50,
  defaultPriority: 5,
  taskTimeout: 300000, // 5 minutes
  enablePriority: true,
};

export class ResourcePool {
  private config: PoolConfig;
  private activeTasks = new Map<string, PoolTask<any>>();
  private queue: Array<PoolTask<any>> = [];
  private metrics: {
    total: number;
    completed: number;
    failed: number;
    timedOut: number;
    waitTimes: number[];
    executionTimes: number[];
  } = {
    total: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    waitTimes: [],
    executionTimes: [],
  };

  constructor(
    private name: string,
    config: Partial<PoolConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info("Resource pool created", { 
      name, 
      maxConcurrent: this.config.maxConcurrent,
      maxQueueSize: this.config.maxQueueSize,
    });
  }

  /**
   * Execute a task with resource pool management
   */
  async execute<T>(
    taskName: string,
    fn: () => Promise<T>,
    options: {
      priority?: number;
      timeout?: number;
      taskId?: string;
    } = {}
  ): Promise<T> {
    const taskId = options.taskId || `${this.name}-${Date.now()}-${Math.random()}`;
    const priority = options.priority ?? this.config.defaultPriority;
    const timeout = options.timeout ?? this.config.taskTimeout;

    // Check if pool is full
    if (
      this.config.maxQueueSize > 0 &&
      this.queue.length >= this.config.maxQueueSize
    ) {
      const error = new Error(
        `Resource pool queue is full (${this.queue.length}/${this.config.maxQueueSize})`
      );
      logger.error("Pool queue full", { 
        name: this.name,
        queueSize: this.queue.length,
        maxQueueSize: this.config.maxQueueSize,
      });
      throw error;
    }

    return new Promise<T>((resolve, reject) => {
      const task: PoolTask<T> = {
        id: taskId,
        name: taskName,
        priority,
        fn,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

      this.metrics.total++;

      // Add to queue
      this.enqueue(task);

      // Set timeout
      if (timeout > 0) {
        task.timeout = setTimeout(() => {
          this.onTaskTimeout(task);
        }, timeout);
      }

      // Try to execute immediately if capacity available
      this.processQueue();
    });
  }

  /**
   * Add task to queue with priority sorting
   */
  private enqueue(task: PoolTask<any>): void {
    this.queue.push(task);

    if (this.config.enablePriority) {
      // Sort by priority (higher priority first), then by queue time
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.queuedAt - b.queuedAt; // Earlier queued first
      });
    }

    logger.debug("Task queued", {
      pool: this.name,
      taskId: task.id,
      taskName: task.name,
      priority: task.priority,
      queueSize: this.queue.length,
    });
  }

  /**
   * Process tasks from the queue
   */
  private processQueue(): void {
    while (
      this.activeTasks.size < this.config.maxConcurrent &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      if (!task) break;

      this.executeTask(task);
    }
  }

  /**
   * Execute a task from the queue
   */
  private async executeTask(task: PoolTask<any>): Promise<void> {
    const waitTime = Date.now() - task.queuedAt;
    this.metrics.waitTimes.push(waitTime);
    
    // Limit metrics arrays to last 100 entries
    if (this.metrics.waitTimes.length > 100) {
      this.metrics.waitTimes.shift();
    }

    task.startedAt = Date.now();
    this.activeTasks.set(task.id, task);

    logger.debug("Task started", {
      pool: this.name,
      taskId: task.id,
      taskName: task.name,
      waitTime,
      activeCount: this.activeTasks.size,
    });

    try {
      const result = await task.fn();
      
      // Clear timeout
      if (task.timeout) {
        clearTimeout(task.timeout);
      }

      const executionTime = Date.now() - task.startedAt;
      this.metrics.executionTimes.push(executionTime);
      
      if (this.metrics.executionTimes.length > 100) {
        this.metrics.executionTimes.shift();
      }

      this.metrics.completed++;
      this.activeTasks.delete(task.id);

      logger.debug("Task completed", {
        pool: this.name,
        taskId: task.id,
        taskName: task.name,
        executionTime,
        activeCount: this.activeTasks.size,
      });

      task.resolve(result);
    } catch (error) {
      // Clear timeout
      if (task.timeout) {
        clearTimeout(task.timeout);
      }

      const executionTime = task.startedAt ? Date.now() - task.startedAt : 0;
      this.metrics.failed++;
      this.activeTasks.delete(task.id);

      logger.error("Task failed", {
        pool: this.name,
        taskId: task.id,
        taskName: task.name,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
      });

      task.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Process next task in queue
      this.processQueue();
    }
  }

  /**
   * Handle task timeout
   */
  private onTaskTimeout(task: PoolTask<any>): void {
    this.metrics.timedOut++;
    
    // Remove from active tasks
    this.activeTasks.delete(task.id);
    
    // Remove from queue if still there
    const queueIndex = this.queue.findIndex((t) => t.id === task.id);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    logger.error("Task timed out", {
      pool: this.name,
      taskId: task.id,
      taskName: task.name,
      timeout: this.config.taskTimeout,
    });

    task.reject(new Error(`Task timed out after ${this.config.taskTimeout}ms`));

    // Process next task
    this.processQueue();
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): PoolMetrics {
    const avgWaitTime = this.metrics.waitTimes.length > 0
      ? this.metrics.waitTimes.reduce((a, b) => a + b, 0) / this.metrics.waitTimes.length
      : 0;

    const avgExecutionTime = this.metrics.executionTimes.length > 0
      ? this.metrics.executionTimes.reduce((a, b) => a + b, 0) / this.metrics.executionTimes.length
      : 0;

    const maxWaitTime = this.metrics.waitTimes.length > 0
      ? Math.max(...this.metrics.waitTimes)
      : 0;

    const maxExecutionTime = this.metrics.executionTimes.length > 0
      ? Math.max(...this.metrics.executionTimes)
      : 0;

    return {
      total: this.metrics.total,
      active: this.activeTasks.size,
      queued: this.queue.length,
      completed: this.metrics.completed,
      failed: this.metrics.failed,
      timedOut: this.metrics.timedOut,
      averageWaitTime: Math.round(avgWaitTime),
      averageExecutionTime: Math.round(avgExecutionTime),
      maxWaitTime,
      maxExecutionTime,
    };
  }

  /**
   * Get current queue info
   */
  getQueueInfo(): Array<{
    id: string;
    name: string;
    priority: number;
    waitTime: number;
  }> {
    const now = Date.now();
    return this.queue.map((task) => ({
      id: task.id,
      name: task.name,
      priority: task.priority,
      waitTime: now - task.queuedAt,
    }));
  }

  /**
   * Get active tasks info
   */
  getActiveTasks(): Array<{
    id: string;
    name: string;
    executionTime: number;
  }> {
    const now = Date.now();
    return Array.from(this.activeTasks.values()).map((task) => ({
      id: task.id,
      name: task.name,
      executionTime: task.startedAt ? now - task.startedAt : 0,
    }));
  }

  /**
   * Cancel a specific task
   */
  cancelTask(taskId: string): boolean {
    // Check active tasks
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      if (activeTask.timeout) {
        clearTimeout(activeTask.timeout);
      }
      this.activeTasks.delete(taskId);
      activeTask.reject(new Error("Task cancelled"));
      this.processQueue();
      return true;
    }

    // Check queue
    const queueIndex = this.queue.findIndex((t) => t.id === taskId);
    if (queueIndex !== -1) {
      const task = this.queue[queueIndex];
      this.queue.splice(queueIndex, 1);
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(new Error("Task cancelled"));
      return true;
    }

    return false;
  }

  /**
   * Clear the queue
   */
  clearQueue(): number {
    const count = this.queue.length;
    for (const task of this.queue) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(new Error("Queue cleared"));
    }
    this.queue = [];
    logger.info("Queue cleared", { pool: this.name, count });
    return count;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      total: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      waitTimes: [],
      executionTimes: [],
    };
    logger.info("Metrics reset", { pool: this.name });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PoolConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info("Pool config updated", { pool: this.name, config: this.config });
    
    // Process queue in case maxConcurrent increased
    this.processQueue();
  }

  /**
   * Get pool status summary
   */
  getStatus(): {
    name: string;
    config: PoolConfig;
    metrics: PoolMetrics;
    utilization: number;
  } {
    const metrics = this.getMetrics();
    const utilization = this.config.maxConcurrent > 0
      ? (metrics.active / this.config.maxConcurrent) * 100
      : 0;

    return {
      name: this.name,
      config: this.config,
      metrics,
      utilization: Math.round(utilization * 100) / 100,
    };
  }
}

/**
 * Pool Manager for managing multiple resource pools
 */
export class PoolManager {
  private pools = new Map<string, ResourcePool>();
  private defaultConfig: Partial<PoolConfig>;

  constructor(defaultConfig: Partial<PoolConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a pool
   */
  getPool(name: string, config?: Partial<PoolConfig>): ResourcePool {
    if (!this.pools.has(name)) {
      const pool = new ResourcePool(name, {
        ...this.defaultConfig,
        ...config,
      });
      this.pools.set(name, pool);
    }
    return this.pools.get(name)!;
  }

  /**
   * Execute a task in a specific pool
   */
  async execute<T>(
    poolName: string,
    taskName: string,
    fn: () => Promise<T>,
    options: {
      priority?: number;
      timeout?: number;
      taskId?: string;
      poolConfig?: Partial<PoolConfig>;
    } = {}
  ): Promise<T> {
    const pool = this.getPool(poolName, options.poolConfig);
    return pool.execute(taskName, fn, options);
  }

  /**
   * Get all pool statuses
   */
  getAllStatuses(): Array<ReturnType<ResourcePool['getStatus']>> {
    return Array.from(this.pools.values()).map((pool) => pool.getStatus());
  }

  /**
   * Get summary across all pools
   */
  getSummary(): {
    totalPools: number;
    totalActive: number;
    totalQueued: number;
    totalCompleted: number;
    totalFailed: number;
  } {
    let totalActive = 0;
    let totalQueued = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    for (const pool of this.pools.values()) {
      const metrics = pool.getMetrics();
      totalActive += metrics.active;
      totalQueued += metrics.queued;
      totalCompleted += metrics.completed;
      totalFailed += metrics.failed;
    }

    return {
      totalPools: this.pools.size,
      totalActive,
      totalQueued,
      totalCompleted,
      totalFailed,
    };
  }

  /**
   * Clear all queues
   */
  clearAllQueues(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.clearQueue();
    }
    return total;
  }

  /**
   * Reset all metrics
   */
  resetAllMetrics(): void {
    for (const pool of this.pools.values()) {
      pool.resetMetrics();
    }
  }
}

// Global pool manager instance
export const poolManager = new PoolManager({
  maxConcurrent: 5,
  maxQueueSize: 50,
  defaultPriority: 5,
  taskTimeout: 300000,
  enablePriority: true,
});
