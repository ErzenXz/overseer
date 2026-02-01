# Subagent System Enhancement

## Overview

The MyBot subagent system has been enhanced with advanced orchestration patterns, circuit breakers, health monitoring, and resource pooling. This implementation provides production-ready resilience, observability, and intelligent task delegation capabilities.

## Architecture Components

### 1. Circuit Breaker Pattern (`src/lib/circuit-breaker.ts`)

Implements the circuit breaker pattern to prevent cascading failures and protect system stability.

**Features:**
- Three states: CLOSED, OPEN, HALF_OPEN
- Configurable failure thresholds and reset timeouts
- Rolling window for failure tracking
- Automatic circuit opening on repeated failures
- Gradual recovery with success threshold
- Per-agent-type circuit breakers

**Usage:**
```typescript
import { circuitBreakerManager } from '@/lib/circuit-breaker';

// Execute with circuit breaker protection
const result = await circuitBreakerManager.execute(
  'subagent-code',
  async () => {
    // Your code here
    return await someOperation();
  }
);

// Check circuit state
const states = circuitBreakerManager.getAllStates();

// Reset a circuit manually
circuitBreakerManager.reset('subagent-code');
```

**Configuration:**
- `failureThreshold`: Number of failures before opening (default: 5)
- `resetTimeout`: Time in ms before attempting half-open (default: 60000)
- `rollingWindowMs`: Window for counting failures (default: 60000)
- `successThreshold`: Successes needed to close from half-open (default: 3)

### 2. Resource Pool Management (`src/lib/resource-pool.ts`)

Manages concurrent execution limits and task queuing with priority support.

**Features:**
- Configurable concurrent execution limits
- Priority-based task queuing
- Task timeout management
- Queue size limits
- Detailed metrics (wait time, execution time, utilization)
- Task cancellation support

**Usage:**
```typescript
import { poolManager } from '@/lib/resource-pool';

// Execute with resource pooling
const result = await poolManager.execute(
  'subagent-code',
  'code-generation-task',
  async () => {
    // Your task
    return await performTask();
  },
  {
    priority: 8, // Higher priority tasks execute first
    timeout: 120000, // 2 minute timeout
  }
);

// Get pool metrics
const metrics = poolManager.getAllStatuses();
```

**Configuration:**
- `maxConcurrent`: Maximum concurrent tasks (default: 5)
- `maxQueueSize`: Maximum queued tasks (default: 50)
- `taskTimeout`: Default task timeout in ms (default: 300000)
- `enablePriority`: Enable priority queuing (default: true)

### 3. Enhanced Subagent Manager (`src/agent/subagents/manager.ts`)

Upgraded orchestration with circuit breakers, health monitoring, and advanced execution patterns.

**New Features:**

#### Health Monitoring
- Success/failure rate tracking per agent type
- Average execution time monitoring
- Performance degradation detection
- Recent execution history

#### Smart Routing
```typescript
import { selectAgentForTask } from '@/agent/subagents/manager';

// Automatically select best agent for a task
const agentType = selectAgentForTask("Implement a REST API endpoint");
// Returns: "code"
```

#### Parallel Execution
```typescript
import { executeParallel } from '@/agent/subagents/manager';

const results = await executeParallel(
  [
    { agentType: 'code', task: 'Create TypeScript interface' },
    { agentType: 'file', task: 'Create directory structure' },
    { agentType: 'git', task: 'Initialize repository' },
  ],
  sessionId,
  model,
  tools
);
```

#### Sequential Execution with Context
```typescript
import { executeSequential } from '@/agent/subagents/manager';

const results = await executeSequential(
  [
    { agentType: 'file', task: 'Read configuration file' },
    { agentType: 'code', task: 'Generate code based on config' },
    { agentType: 'git', task: 'Commit generated code' },
  ],
  sessionId,
  model,
  tools
);
// Each step receives results from previous steps
```

#### Execution Graph with Dependencies
```typescript
import { executeGraph, type ExecutionGraph } from '@/agent/subagents/manager';

const graph: ExecutionGraph = {
  id: 'graph-1',
  nodes: [
    { 
      id: 'step-1', 
      agentType: 'file', 
      task: 'Read files',
      dependencies: [],
      status: 'pending'
    },
    { 
      id: 'step-2', 
      agentType: 'code', 
      task: 'Process files',
      dependencies: ['step-1'], // Waits for step-1
      status: 'pending'
    },
    { 
      id: 'step-3', 
      agentType: 'git', 
      task: 'Commit changes',
      dependencies: ['step-2'], // Waits for step-2
      status: 'pending'
    },
  ],
  createdAt: Date.now(),
  status: 'pending',
};

const completedGraph = await executeGraph(graph, sessionId, model, tools);
```

### 4. New Subagent Types

#### Planner Agent (`src/agent/subagents/planner.ts`)
Decomposes complex tasks into actionable steps with dependencies.

```typescript
import { createExecutionPlan, planToGraph } from '@/agent/subagents/planner';

const plan = createExecutionPlan(
  'Build a REST API with authentication',
  'Use Express.js and JWT'
);

// Returns:
// {
//   id: 'plan-123',
//   goal: 'Build a REST API with authentication',
//   steps: [
//     { id: 'step-1', agentType: 'code', description: '...', dependencies: [] },
//     { id: 'step-2', agentType: 'db', description: '...', dependencies: ['step-1'] },
//     // ...
//   ],
//   estimatedTotalDuration: 120000,
//   parallelizable: true
// }

// Convert to execution graph
const graph = planToGraph(plan);
```

#### Evaluator Agent (`src/agent/subagents/evaluator.ts`)
Reviews outputs from other agents for quality and correctness.

```typescript
import { evaluateTaskResult, evaluateMultipleResults } from '@/agent/subagents/evaluator';

const evaluation = evaluateTaskResult(taskResult, 'Expected output description');

// Returns:
// {
//   score: 8.5,
//   passed: true,
//   strengths: ['Fast execution time', 'Detailed output provided'],
//   issues: [],
//   recommendations: [],
//   criteria: {
//     correctness: true,
//     completeness: true,
//     quality: true,
//     bestPractices: true
//   }
// }

// Evaluate multiple results
const multiEval = evaluateMultipleResults([result1, result2, result3]);
```

#### Coordinator Agent
Orchestrates multiple parallel subagents and aggregates results.

### 5. Health Monitoring API (`src/app/api/subagents/health/route.ts`)

REST API for monitoring subagent health and managing system state.

**Endpoints:**

#### GET /api/subagents/health
Get comprehensive health information

```bash
curl http://localhost:3000/api/subagents/health
```

Response:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "overall": {
    "health": 95.5,
    "status": "healthy",
    "degradedAgents": 0,
    "openCircuits": 0
  },
  "agents": {
    "code": {
      "totalExecutions": 150,
      "successCount": 145,
      "failureCount": 5,
      "successRate": 0.967,
      "averageExecutionTime": 12500
    }
  },
  "circuitBreakers": {
    "summary": { "closed": 12, "open": 0, "halfOpen": 0 },
    "states": [...]
  },
  "resourcePools": {
    "summary": {
      "totalActive": 3,
      "totalQueued": 5,
      "totalCompleted": 250,
      "totalFailed": 10
    }
  },
  "degradedAgents": [],
  "recommendations": ["All systems operating normally."]
}
```

#### GET /api/subagents/health?type=code
Get health for specific agent type

#### POST /api/subagents/health
Perform administrative actions

```bash
# Reset circuit breaker
curl -X POST http://localhost:3000/api/subagents/health \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-circuit", "agentType": "code"}'

# Reset all circuit breakers
curl -X POST http://localhost:3000/api/subagents/health \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-circuit"}'

# Clear all queues
curl -X POST http://localhost:3000/api/subagents/health \
  -H "Content-Type: application/json" \
  -d '{"action": "clear-queues"}'

# Reset pool metrics
curl -X POST http://localhost:3000/api/subagents/health \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-pool-metrics"}'
```

### 6. Enhanced Dashboard UI (`src/app/(dashboard)/subagents/page.tsx`)

Rich monitoring interface with real-time health metrics.

**Features:**
- Overall system health score and status
- Real-time circuit breaker states
- Resource pool utilization
- Success rate per agent type
- Performance degradation alerts
- One-click circuit reset
- Auto-refresh (10s interval)
- Actionable recommendations

## Configuration

### Global Configuration

Create or update `config/subagents.json`:

```json
{
  "circuitBreaker": {
    "failureThreshold": 5,
    "resetTimeout": 60000,
    "rollingWindowMs": 60000,
    "successThreshold": 3
  },
  "resourcePool": {
    "maxConcurrent": 5,
    "maxQueueSize": 50,
    "taskTimeout": 300000,
    "enablePriority": true
  },
  "agents": {
    "code": {
      "priority": 7,
      "maxConcurrent": 3
    },
    "system": {
      "priority": 8,
      "maxConcurrent": 2
    }
  }
}
```

### Per-Agent Configuration

Each agent type can have custom priority and resource limits:

```typescript
const config = getSubAgentConfig('code');
// {
//   name: 'Code Agent',
//   description: '...',
//   system_prompt: '...',
//   tools: [...],
//   priority: 7
// }
```

## Monitoring and Observability

### Health Metrics

Access health metrics programmatically:

```typescript
import { 
  getAllHealthMetrics, 
  getHealthMetrics,
  detectPerformanceDegradation 
} from '@/agent/subagents/manager';

// Get all metrics
const allMetrics = getAllHealthMetrics();

// Get specific agent
const codeMetrics = getHealthMetrics('code');

// Check for degradation
const degradation = detectPerformanceDegradation('code');
if (degradation.degraded) {
  console.log('Reasons:', degradation.reasons);
}
```

### Circuit Breaker Monitoring

```typescript
import { circuitBreakerManager } from '@/lib/circuit-breaker';

// Get all states
const summary = circuitBreakerManager.getSummary();
console.log(`Open circuits: ${summary.open}`);

// Get detailed states
const states = circuitBreakerManager.getAllStates();
for (const state of states) {
  console.log(`${state.name}: ${state.state}`);
}
```

### Resource Pool Monitoring

```typescript
import { poolManager } from '@/lib/resource-pool';

// Get summary
const summary = poolManager.getSummary();
console.log(`Active tasks: ${summary.totalActive}`);
console.log(`Queued tasks: ${summary.totalQueued}`);

// Get detailed pool statuses
const statuses = poolManager.getAllStatuses();
for (const pool of statuses) {
  console.log(`Pool ${pool.name}: ${pool.utilization}% utilized`);
}
```

## Best Practices

### 1. Use Smart Routing

Let the system select the best agent for your task:

```typescript
const agentType = selectAgentForTask(userRequest);
const agent = createSubAgent({
  parent_session_id: sessionId,
  agent_type: agentType,
  assigned_task: userRequest
});
```

### 2. Leverage Parallel Execution

For independent tasks, use parallel execution:

```typescript
// Good: Parallel execution
const results = await executeParallel([
  { agentType: 'file', task: 'Read config' },
  { agentType: 'web', task: 'Fetch API data' },
  { agentType: 'db', task: 'Query database' }
], sessionId, model, tools);

// Bad: Sequential when unnecessary
for (const task of tasks) {
  await executeTask(...); // Slow!
}
```

### 3. Handle Circuit Breaker States

Always handle circuit breaker errors gracefully:

```typescript
try {
  const result = await executeTask(agentId, model, tools);
} catch (error) {
  if (error.message.includes('Circuit breaker is OPEN')) {
    // Use fallback strategy
    logger.warn('Circuit open, using fallback');
    return await fallbackStrategy();
  }
  throw error;
}
```

### 4. Monitor Health Regularly

Set up periodic health checks:

```typescript
setInterval(async () => {
  const health = await fetch('/api/subagents/health').then(r => r.json());
  
  if (health.overall.health < 70) {
    sendAlert('Subagent system degraded', health.recommendations);
  }
  
  if (health.overall.openCircuits > 0) {
    sendAlert('Circuit breakers open', health.circuitBreakers.states);
  }
}, 60000); // Check every minute
```

### 5. Use Execution Graphs for Complex Workflows

For multi-step tasks with dependencies:

```typescript
const plan = createExecutionPlan(complexTask, context);
const graph = planToGraph(plan);
const result = await executeGraph(graph, sessionId, model, tools);

// Evaluate results
const evaluation = evaluateMultipleResults(
  graph.nodes.map(n => n.result!)
);

if (!evaluation.passed) {
  logger.warn('Workflow quality issues', evaluation.recommendations);
}
```

### 6. Set Appropriate Priorities

High-priority tasks should bypass queues:

```typescript
// Critical task
await poolManager.execute(
  'subagent-security',
  'security-scan',
  criticalTask,
  { priority: 10 } // Highest priority
);

// Background task
await poolManager.execute(
  'subagent-code',
  'code-cleanup',
  backgroundTask,
  { priority: 3 } // Low priority
);
```

## Troubleshooting

### Circuit Breaker Won't Close

**Symptoms:** Circuit remains OPEN despite fixes

**Solutions:**
1. Check failure rate in metrics
2. Ensure underlying issues are fixed
3. Manually reset: `circuitBreakerManager.reset('subagent-type')`
4. Review agent logs for recurring errors

### High Queue Depth

**Symptoms:** Many tasks queued, slow execution

**Solutions:**
1. Increase `maxConcurrent` in pool config
2. Check for slow-running tasks
3. Use priority to process important tasks first
4. Consider scaling horizontally

### Performance Degradation

**Symptoms:** Slow execution times, low success rates

**Solutions:**
1. Check agent health metrics
2. Review recent failures in logs
3. Optimize agent prompts and tools
4. Consider agent-specific timeout adjustments

### Memory Issues

**Symptoms:** High memory usage, OOM errors

**Solutions:**
1. Reduce `maxConcurrent` to limit parallel tasks
2. Implement task timeouts
3. Clear old health metrics periodically
4. Review and optimize agent tool usage

## Migration Guide

### From Old System

1. Update imports:
```typescript
// Old
import { executeTask } from '@/agent/subagents/manager';

// New (same import, enhanced functionality)
import { 
  executeTask,
  executeParallel,
  executeSequential,
  executeGraph
} from '@/agent/subagents/manager';
```

2. Existing `executeTask` calls work without changes, but now benefit from:
   - Circuit breaker protection
   - Resource pooling
   - Health monitoring
   - Performance tracking

3. Update UI components to use new health API:
```typescript
// Add health monitoring to your dashboard
const [health, setHealth] = useState(null);

useEffect(() => {
  fetch('/api/subagents/health')
    .then(r => r.json())
    .then(setHealth);
}, []);
```

## Performance Considerations

- **Circuit Breakers:** Minimal overhead (~1ms per call)
- **Resource Pools:** Queue operations are O(n log n) for priority sorting
- **Health Metrics:** In-memory storage with rolling window (last 50 executions)
- **Monitoring API:** Cached for 1 second to reduce DB load

## Future Enhancements

- [ ] Persistent health metrics to database
- [ ] Advanced anomaly detection using ML
- [ ] Dynamic circuit breaker thresholds based on agent performance
- [ ] Distributed tracing integration
- [ ] Custom alerting rules and webhooks
- [ ] Agent performance profiling and optimization suggestions
- [ ] Multi-region subagent deployment
- [ ] Advanced cost tracking per agent execution

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review system logs in `/logs`
3. Check health API for system state
4. Review metrics in the dashboard

## License

Same as MyBot project license.
