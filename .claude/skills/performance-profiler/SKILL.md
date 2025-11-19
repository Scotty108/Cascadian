---
name: performance-profiler
description: Diagnose performance bottlenecks in parallel data processing. Use when actual throughput doesn't match expected parallelization gains or when optimizing backfills/pipelines.
---

# Performance Profiler Skill

## When to Use

Invoke this skill when:
- ✅ Parallel workers running slower than expected (N workers ≈ 1 worker performance)
- ✅ Backfill or data pipeline taking too long (> 2x expected time)
- ✅ Need concrete timing breakdown before optimization
- ✅ Investigating why performance doesn't scale with worker count

**Example triggers**:
- "Why is this 64-worker backfill taking 24 hours?"
- "Profile the Goldsky ingestion performance"
- "Diagnose why my parallel script isn't parallelizing"

## Diagnostic Workflow

### 1. Capture Baseline (2-3 min)
```bash
# Record current state
- Current throughput rate (items/sec or items/min)
- Worker count
- Total items to process
- Estimated time to completion (ETA)
- Checkpoint status (if applicable)
```

**Output**: Baseline metrics table

### 2. Profile Small Sample (5-10 min)
Create a profiling script that measures each component separately:

```typescript
async function profileSample(items: Item[], sampleSize = 10) {
  console.log(`Profiling ${sampleSize} items...`);

  const timings = [];

  for (let i = 0; i < sampleSize; i++) {
    const item = items[i];
    const totalStart = performance.now();

    // Measure each step
    const fetchStart = performance.now();
    const data = await fetchData(item);
    const fetchMs = performance.now() - fetchStart;

    const transformStart = performance.now();
    const transformed = transform(data);
    const transformMs = performance.now() - transformStart;

    const writeStart = performance.now();
    await writeToDatabase(transformed);
    const writeMs = performance.now() - writeStart;

    const totalMs = performance.now() - totalStart;

    timings.push({ fetchMs, transformMs, writeMs, totalMs });
  }

  // Calculate averages
  const avg = {
    fetch: mean(timings.map(t => t.fetchMs)),
    transform: mean(timings.map(t => t.transformMs)),
    write: mean(timings.map(t => t.writeMs)),
    total: mean(timings.map(t => t.totalMs)),
  };

  // Calculate percentages
  console.log('AVERAGES:');
  console.log(`Fetch: ${avg.fetch}ms (${(avg.fetch/avg.total*100).toFixed(1)}%)`);
  console.log(`Transform: ${avg.transform}ms (${(avg.transform/avg.total*100).toFixed(1)}%)`);
  console.log(`Write: ${avg.write}ms (${(avg.write/avg.total*100).toFixed(1)}%)`);
  console.log(`Total: ${avg.total}ms`);

  return avg;
}
```

**Output**: Timing breakdown table with percentages

### 3. Calculate Parallelization Factor (1-2 min)
```typescript
const singleWorkerRate = 1000 / avg.total; // items/sec
const theoreticalRate = singleWorkerRate * WORKER_COUNT;
const actualRate = baseline.currentRate;
const serializationFactor = theoreticalRate / actualRate;

console.log(`Single worker: ${singleWorkerRate.toFixed(2)} items/sec`);
console.log(`Theoretical (${WORKER_COUNT} workers): ${theoreticalRate.toFixed(2)} items/sec`);
console.log(`Actual: ${actualRate.toFixed(2)} items/sec`);
console.log(`Serialization factor: ${serializationFactor.toFixed(1)}x`);
```

**Output**: Performance comparison showing gap between theoretical and actual

### 4. Identify Bottleneck Category (1-2 min)
```typescript
// Decision tree based on serialization factor
if (serializationFactor > 10) {
  console.log('🔴 CRITICAL: Lock contention detected (> 10x serialization)');
  console.log('Root cause: Database write locks or filesystem contention');
  console.log('Fix: Implement batched writes');
} else if (serializationFactor > 3) {
  console.log('🟡 WARNING: Moderate contention (3-10x serialization)');
  console.log('Root cause: Connection pool exhaustion');
  console.log('Fix: Increase connection pool or reduce workers');
} else if (serializationFactor > 1.5) {
  console.log('🟢 MINOR: Slight overhead (1.5-3x serialization)');
  console.log('Root cause: API rate limiting or CPU contention');
  console.log('Fix: Reduce worker count or add backoff');
} else {
  console.log('✅ GOOD: Near-linear scaling');
  console.log('Recommendation: Increase worker count if possible');
}
```

**Output**: Root cause category with recommended fix

### 5. Generate Optimization Plan (3-5 min)
Based on bottleneck category, provide specific code changes:

**For database write contention (> 10x serialization)**:
```typescript
// BEFORE (BAD): Individual writes
for (let item of items) {
  await db.insert(item); // ← N workers all hitting database
}

// AFTER (GOOD): Batched writes
let buffer = [];
for (let item of items) {
  buffer.push(item);

  if (buffer.length >= BATCH_SIZE) {
    await db.batchInsert(buffer);
    buffer = [];
  }
}
if (buffer.length > 0) await db.batchInsert(buffer);
```

**For checkpoint contention**:
```typescript
// BEFORE: Synchronous checkpoint every N items
if (count % CHECKPOINT_INTERVAL === 0) {
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(state));
}

// AFTER: Atomic checkpoint with reduced frequency
if (count % (CHECKPOINT_INTERVAL * 5) === 0) {
  const tempFile = CHECKPOINT_FILE + '.tmp';
  await fs.writeFile(tempFile, JSON.stringify(state));
  await fs.rename(tempFile, CHECKPOINT_FILE);
}
```

**For connection pool exhaustion**:
```typescript
// Increase pool size
const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  max_open_connections: WORKER_COUNT * 2, // ← Double worker count
});
```

**Output**: Specific code fix with before/after examples

## Output Format

### Performance Profile Report
```markdown
# Performance Profile: [Task Name]

## Baseline Metrics
- Current rate: X items/sec
- Worker count: N
- Total ETA: Y hours
- Status: Z% complete

## Profiling Results (Sample Size: 10)

| Step | Avg Time | % of Total |
|------|----------|------------|
| Fetch | Xms | Y% |
| Transform | Xms | Y% |
| Write | Xms | Y% |
| **Total** | **Xms** | **100%** |

## Parallelization Analysis

| Configuration | Rate | ETA | Notes |
|---------------|------|-----|-------|
| Single worker | X items/sec | Y hours | Baseline |
| N workers (theoretical) | X items/sec | Y min | If perfect scaling |
| **N workers (actual)** | **X items/sec** | **Y hours** | **Zx serialization** |

## Root Cause
[Category: Lock contention / Connection pool / Rate limiting / CPU bound]

## Recommended Fix
[Specific code changes with before/after examples]

## Expected Improvement
- Optimized rate: X items/sec
- Optimized ETA: Y minutes
- Improvement: Zx faster
```

## Tools & Scripts

### Create Profiling Script Template
```bash
# Generate profiling script
cat > scripts/profile-[task-name].ts << 'EOF'
#!/usr/bin/env npx tsx

import { performance } from 'perf_hooks';

async function profileTask() {
  // [Insert profiling logic from template above]
}

profileTask().catch(console.error);
EOF

chmod +x scripts/profile-[task-name].ts
```

### Run Profile
```bash
npx tsx scripts/profile-[task-name].ts | tee tmp/[task-name]-profile.txt
```

## Related Skills
- **parallel-worker-debugger** - Deep dive into why workers aren't parallelizing
- **database-write-optimizer** - Transform individual writes to batched inserts
- **backfill-production-ready** - Create production readiness checklist

## Real-World Example: Goldsky CLOB Fills Optimization

**Problem**: 64-worker backfill running at 1.97 markets/sec (24-hour ETA)

**Profile Results**:
- GraphQL: 205ms (46.5%)
- Transform: 0ms (0.0%)
- ClickHouse: 236ms (53.5%)
- Total: 441ms per market

**Parallelization Analysis**:
- Single worker: 2.27 markets/sec
- 64 workers (theoretical): 145 markets/sec
- 64 workers (actual): 1.97 markets/sec
- **Serialization factor: 74x** ← Problem!

**Root Cause**: ClickHouse write lock contention (each worker calling `clickhouse.exec()` individually)

**Fix Applied**: Batched inserts accumulating 5,000 fills before INSERT
```typescript
let fillBuffer: FillRow[] = [];
let bufferLock = Promise.resolve();

async function addToBuffer(fills: FillRow[]) {
  bufferLock = bufferLock.then(async () => {
    fillBuffer.push(...fills);
    if (fillBuffer.length >= INSERT_BATCH_SIZE) {
      await flushFillBuffer();
    }
  });
  await bufferLock;
}
```

**Result**: 3.5x improvement per worker (6.8 markets/sec with 8 workers)

**Final Configuration**: 128 workers, 26-minute ETA (55x total improvement)

## Checklist

Before completing profile, verify:
- [x] Baseline metrics captured
- [x] Profiling script measures each component separately
- [x] Parallelization factor calculated
- [x] Root cause identified with evidence
- [x] Specific fix provided with code examples
- [x] Expected improvement projected
- [x] Output saved to `tmp/[task-name]-profile.txt`

## Token Savings

**Without this skill**: ~2,000 tokens
- Explain profiling methodology (~800 tokens)
- Create profiling script (~600 tokens)
- Analyze results (~400 tokens)
- Recommend optimizations (~200 tokens)

**With this skill**: ~50 tokens
- "Use performance-profiler skill on [task]"

**Savings**: ~1,950 tokens per use (97% reduction)

---

**Last Updated**: 2025-11-11
**Status**: ✅ Production-ready (validated on Goldsky CLOB optimization)
