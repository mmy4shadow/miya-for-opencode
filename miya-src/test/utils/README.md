# Test Utilities Documentation

This directory contains reusable test utilities, mocks, and helpers for the Miya plugin test suite.

## Overview

The test utilities provide:

- **Common test helpers** for async operations, assertions, and test setup
- **Mock Gateway** for testing without real WebSocket connections
- **Mock Daemon** for testing without actual model inference or system automation
- **Test data generators** for creating realistic test data

## Files

### test-helpers.ts

Common utilities for test setup, teardown, assertions, and data generation.

#### Key Functions

**Async Utilities:**
- `sleep(ms)` - Sleep for specified milliseconds
- `waitFor(condition, timeout, interval)` - Wait for a condition to become true
- `retry(fn, maxRetries, initialDelay)` - Retry a function with exponential backoff

**Test Isolation:**
- `createTempDir(prefix)` - Create a temporary directory
- `cleanupTempDir(path)` - Clean up a temporary directory
- `deepClone(obj)` - Deep clone an object for test isolation

**Mocking:**
- `mockConsole()` - Mock console methods and capture logs
- `createSpy(implementation)` - Create a spy function with call tracking
- `createMockTimer()` - Create a mock timer for testing time-dependent code

**Assertions:**
- `assertDefined(value, message)` - Assert value is not null/undefined
- `assertThrows(fn, expectedError)` - Assert async function throws
- `assertPerformance(fn, maxDuration, message)` - Assert execution time is within bounds

**Random Data:**
- `randomString(length, charset)` - Generate random string
- `randomInt(min, max)` - Generate random integer
- `randomPick(array)` - Pick random element from array

**Fixtures:**
- `createFixture(setup, teardown)` - Create test fixture with setup/teardown

**Performance:**
- `measureTime(fn)` - Measure execution time of a function

#### Usage Examples

```typescript
import { sleep, waitFor, createSpy, assertThrows } from './test-helpers';

// Wait for async condition
await waitFor(() => server.isReady(), 5000);

// Create spy
const spy = createSpy((x: number) => x * 2);
spy(5);
expect(spy.calls).toHaveLength(1);
expect(spy.results[0]).toBe(10);

// Assert throws
await assertThrows(
  async () => { throw new Error('test'); },
  'test'
);

// Mock console
const consoleMock = mockConsole();
console.log('test message');
expect(consoleMock.logs).toContain('test message');
consoleMock.restore();
```

### mock-gateway.ts

Mock implementation of the Gateway control plane for testing without real WebSocket connections.

#### Key Classes

**MockGateway:**
- Simulates Gateway RPC protocol
- Tracks all requests and responses
- Supports backpressure simulation
- Provides latency and failure simulation

#### Configuration Options

```typescript
interface MockGatewayConfig {
  logRequests?: boolean;        // Enable request logging
  latency?: number;             // Simulate network latency (ms)
  failureRate?: number;         // Simulate random failures (0-1)
  maxInFlight?: number;         // Maximum in-flight requests
  maxQueue?: number;            // Maximum queue size
  timeout?: number;             // Request timeout (ms)
}
```

#### Usage Examples

```typescript
import { createMockGateway, createMockGatewayWithStubs } from './mock-gateway';

// Create basic gateway
const gateway = createMockGateway({ latency: 10 });

// Register method handlers
gateway.registerMethod('channels.send', async (params) => {
  return { success: true, messageId: '123' };
});

// Call methods
const result = await gateway.call('channels.send', {
  recipient: 'user@example.com',
  message: 'Hello'
});

// Verify calls
expect(gateway.getRequests()).toHaveLength(1);
expect(gateway.getRequests()[0].method).toBe('channels.send');

// Create gateway with pre-registered stubs
const gatewayWithStubs = createMockGatewayWithStubs();
const result = await gatewayWithStubs.call('channels.send', { ... });
```

#### Available Methods

**Method Registration:**
- `registerMethod(method, handler)` - Register a method handler
- `unregisterMethod(method)` - Unregister a method
- `hasMethod(method)` - Check if method is registered

**Method Invocation:**
- `call(method, params)` - Call a Gateway method

**Request/Response Tracking:**
- `getRequests()` - Get all requests
- `getRequestsForMethod(method)` - Get requests for specific method
- `getResponses()` - Get all responses
- `getLastRequest()` - Get last request
- `getLastResponse()` - Get last response

**State Management:**
- `clear()` - Clear request/response history
- `reset()` - Reset gateway completely
- `getInFlightCount()` - Get in-flight request count
- `getQueueSize()` - Get queue size

**Metrics:**
- `getAverageResponseTime()` - Get average response time
- `getSuccessRate()` - Get success rate (0-1)

### mock-daemon.ts

Mock implementation of the Daemon execution layer for testing without actual model inference or system automation.

#### Key Classes

**MockDaemon:**
- Simulates task execution
- Manages VRAM allocations
- Supports human mutex simulation
- Tracks task lifecycle

#### Configuration Options

```typescript
interface MockDaemonConfig {
  logTasks?: boolean;           // Enable task logging
  executionTime?: number;       // Simulate execution time (ms)
  failureRate?: number;         // Simulate random failures (0-1)
  vramAvailable?: number;       // Available VRAM in MB
  humanMutex?: boolean;         // Simulate human mutex (user active)
}
```

#### Usage Examples

```typescript
import { createMockDaemon } from './mock-daemon';

// Create daemon
const daemon = createMockDaemon({ vramAvailable: 8192 });

// Submit a task
const taskId = await daemon.submitTask('image_generation', {
  prompt: 'A beautiful sunset',
  model: 'flux-schnell'
});

// Wait for completion
await daemon.waitForTask(taskId);

// Get result
const task = daemon.getTask(taskId);
expect(task.status).toBe('completed');
expect(task.result.imagePath).toBeDefined();

// Check VRAM usage
const vramUsed = daemon.getTotalVRAMUsed();
const vramAvailable = daemon.getAvailableVRAM();

// Cancel a task
daemon.cancelTask(taskId);

// Simulate connection loss
daemon.disconnect();
daemon.reconnect();
```

#### Supported Task Types

- `image_generation` - Image generation with FLUX models
- `voice_training` - Voice training with GPT-SoVITS
- `voice_inference` - Voice inference
- `asr` - Automatic speech recognition
- `desktop_control` - Desktop automation
- `training` - Generic training tasks

#### Available Methods

**Task Management:**
- `submitTask(type, params)` - Submit a task
- `getTask(taskId)` - Get task by ID
- `getAllTasks()` - Get all tasks
- `getTasksByStatus(status)` - Get tasks by status
- `getTasksByType(type)` - Get tasks by type
- `waitForTask(taskId, timeout)` - Wait for task completion
- `cancelTask(taskId)` - Cancel a task

**VRAM Management:**
- `getTotalVRAMUsed()` - Get total VRAM in use
- `getAvailableVRAM()` - Get available VRAM
- `setHumanMutex(active)` - Set human mutex state

**Connection Management:**
- `isConnected()` - Check connection status
- `disconnect()` - Simulate connection loss
- `reconnect()` - Simulate reconnection

**State Management:**
- `clear()` - Clear all tasks
- `reset()` - Reset daemon completely

**Statistics:**
- `getStatistics()` - Get comprehensive statistics

### test-data-generator.ts

Utilities for generating realistic test data for various Miya plugin components.

#### Key Functions

**Data Generators:**
- `generatePolicy(overrides)` - Generate policy configuration
- `generateMemory(overrides)` - Generate memory record
- `generateEvidenceBundle(actionType, overrides)` - Generate evidence bundle
- `generateConfig(overrides)` - Generate configuration object
- `generateUser(overrides)` - Generate user profile
- `generateTask(overrides)` - Generate task record
- `generateApprovalRequest(overrides)` - Generate approval request
- `generateKillSwitchEvent(overrides)` - Generate Kill-Switch event

**Batch Generation:**
- `generateBatch(type, count, overrides)` - Generate batch of items

**Complex Data:**
- `generateConversation(messageCount)` - Generate conversation history
- `generateFileTree(depth, filesPerDir)` - Generate file tree structure
- `generateBenchmarkData(metricName, sampleCount)` - Generate benchmark data

#### Usage Examples

```typescript
import {
  generatePolicy,
  generateMemory,
  generateEvidenceBundle,
  generateBatch,
  generateConversation
} from './test-data-generator';

// Generate single items
const policy = generatePolicy({ riskTier: 'THOROUGH' });
const memory = generateMemory({ domain: 'work_memory' });
const evidence = generateEvidenceBundle('fs_write');

// Generate batches
const memories = generateBatch('memory', 10);
const users = generateBatch('user', 5, { tier: 'friend' });

// Generate complex data
const conversation = generateConversation(20);
const fileTree = generateFileTree(3, 5);
const benchmark = generateBenchmarkData('rpc_latency', 100);
```

#### Evidence Bundle Types

The generator supports all evidence bundle types:
- `fs_write` - File system write operations
- `shell_exec` - Shell command execution
- `desktop_control` - Desktop automation
- `outbound_send` - Outbound message sending
- `memory_write` - Memory write operations
- `training` - Training operations

## Best Practices

### 1. Test Isolation

Always use test fixtures and cleanup:

```typescript
import { createFixture, createTempDir, cleanupTempDir } from './test-helpers';

const tempDirFixture = createFixture(
  async () => await createTempDir('my-test-'),
  async (dir) => await cleanupTempDir(dir)
);

test('my test', async () => {
  await tempDirFixture.use(async (tmpDir) => {
    // Use tmpDir for test
  });
});
```

### 2. Mock External Dependencies

Use mocks to avoid external dependencies:

```typescript
import { createMockGateway, createMockDaemon } from './test-utils';

test('integration test', async () => {
  const gateway = createMockGateway();
  const daemon = createMockDaemon();
  
  // Test without real Gateway/Daemon
});
```

### 3. Generate Realistic Test Data

Use data generators for realistic test data:

```typescript
import { generateBatch } from './test-data-generator';

test('memory system', async () => {
  const memories = generateBatch('memory', 100);
  // Test with realistic data
});
```

### 4. Verify Behavior with Spies

Use spies to verify function calls:

```typescript
import { createSpy } from './test-helpers';

test('callback is called', async () => {
  const callback = createSpy();
  await someAsyncOperation(callback);
  
  expect(callback.calls).toHaveLength(1);
  expect(callback.calls[0]).toEqual([expectedArg]);
});
```

### 5. Test Performance

Use performance assertions:

```typescript
import { assertPerformance } from './test-helpers';

test('operation is fast', async () => {
  await assertPerformance(
    async () => await fastOperation(),
    100,
    'Operation should complete in under 100ms'
  );
});
```

## Contributing

When adding new utilities:

1. Add comprehensive JSDoc comments
2. Provide usage examples
3. Update this README
4. Add unit tests for the utility itself
5. Follow existing naming conventions

## Related Documentation

- [Test Execution Guide](../TEST_EXECUTION_GUIDE.md)
- [Test Configuration](../config/test.config.ts)
- [Design Document](../../../.kiro/specs/miya-plugin-audit/design.md)
