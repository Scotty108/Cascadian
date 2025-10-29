# Goldsky Batch Resolver API Reference

## Quick Start

```typescript
import { batchResolveTokenIds, CachedTokenResolver } from '@/lib/goldsky/batch-resolver'

// Simple batch resolution
const result = await batchResolveTokenIds(['123', '456', '789'])
console.log(`Resolved ${result.resolved.length} tokens in ${result.duration}ms`)

// With caching
const resolver = new CachedTokenResolver()
await resolver.warmCache(['123', '456', '789'])
const mapping = await resolver.resolveToken('123')
```

## API Reference

### `batchResolveTokenIds()`

Resolve multiple token IDs in a single GraphQL query.

```typescript
function batchResolveTokenIds(
  tokenIds: string[],
  batchSize?: number
): Promise<BatchResolveResult>
```

#### Parameters
- `tokenIds` (string[]) - Array of token IDs to resolve
- `batchSize` (number, optional) - Max tokens per batch. Default: 25,000

#### Returns
```typescript
interface BatchResolveResult {
  resolved: TokenMapping[]    // Successfully resolved tokens
  notFound: string[]          // Token IDs not found in Goldsky
  duration: number            // Total duration in milliseconds
}

interface TokenMapping {
  tokenId: string
  conditionId: string
  outcome: number
}
```

#### Example
```typescript
const tokenIds = ['1', '2', '3', '4', '5']
const result = await batchResolveTokenIds(tokenIds)

// Access resolved mappings
result.resolved.forEach(({ tokenId, conditionId, outcome }) => {
  console.log(`Token ${tokenId} → Condition ${conditionId}, Outcome ${outcome}`)
})

// Handle not found
if (result.notFound.length > 0) {
  console.log(`Could not resolve: ${result.notFound.join(', ')}`)
}

// Performance metrics
console.log(`Resolved ${result.resolved.length}/${tokenIds.length} in ${result.duration}ms`)
```

---

### `CachedTokenResolver`

Cached resolver for incremental/streaming workloads. Maintains an in-memory cache to avoid duplicate API calls.

```typescript
class CachedTokenResolver {
  constructor(batchSize?: number)

  async warmCache(tokenIds: string[]): Promise<void>
  async resolveToken(tokenId: string): Promise<{conditionId: string, outcome: number} | null>
  async resolveTokens(tokenIds: string[]): Promise<Map<string, {conditionId: string, outcome: number} | null>>

  getCacheSize(): number
  clearCache(): void
  exportCache(): Record<string, {conditionId: string, outcome: number} | null>
  importCache(data: Record<string, {conditionId: string, outcome: number} | null>): void
}
```

#### Constructor
```typescript
const resolver = new CachedTokenResolver(batchSize?: number)
```
- `batchSize` (optional) - Batch size for API calls. Default: 25,000

#### Methods

##### `warmCache()`
Pre-fetch and cache multiple token IDs.

```typescript
await resolver.warmCache(tokenIds: string[]): Promise<void>
```

**Example:**
```typescript
const tokenIds = ['1', '2', '3', '100', '200']
await resolver.warmCache(tokenIds)
// Now all subsequent lookups are instant
```

##### `resolveToken()`
Resolve a single token (uses cache if available).

```typescript
const mapping = await resolver.resolveToken(tokenId: string)
```

**Returns:** `{conditionId: string, outcome: number} | null`

**Example:**
```typescript
const mapping = await resolver.resolveToken('123')
if (mapping) {
  console.log(`Condition: ${mapping.conditionId}, Outcome: ${mapping.outcome}`)
}
```

##### `resolveTokens()`
Resolve multiple tokens (batches uncached, returns all).

```typescript
const results = await resolver.resolveTokens(tokenIds: string[])
```

**Returns:** `Map<string, {conditionId: string, outcome: number} | null>`

**Example:**
```typescript
const tokenIds = ['1', '2', '3']
const results = await resolver.resolveTokens(tokenIds)

tokenIds.forEach(id => {
  const mapping = results.get(id)
  if (mapping) {
    console.log(`Token ${id}: ${mapping.conditionId}`)
  }
})
```

##### `getCacheSize()`
Get number of cached tokens.

```typescript
const size = resolver.getCacheSize()
console.log(`Cache contains ${size} tokens`)
```

##### `clearCache()`
Clear all cached tokens.

```typescript
resolver.clearCache()
```

##### `exportCache()`
Export cache to JSON for persistence.

```typescript
const cacheData = resolver.exportCache()
fs.writeFileSync('token-cache.json', JSON.stringify(cacheData))
```

##### `importCache()`
Import cache from JSON.

```typescript
const cacheData = JSON.parse(fs.readFileSync('token-cache.json', 'utf-8'))
resolver.importCache(cacheData)
console.log(`Loaded ${resolver.getCacheSize()} cached tokens`)
```

---

## Usage Patterns

### Pattern 1: One-Time Batch Resolution

Best for: Scripts that process all data at once

```typescript
import { batchResolveTokenIds } from '@/lib/goldsky/batch-resolver'

const allTokenIds = await getAllUniqueTokenIds()
const result = await batchResolveTokenIds(allTokenIds, 25000)

// Create lookup map
const tokenMap = new Map(
  result.resolved.map(m => [m.tokenId, m])
)

// Use in transformations
trades.forEach(trade => {
  const mapping = tokenMap.get(trade.tokenId)
  if (mapping) {
    trade.condition_id = mapping.conditionId
    trade.outcome = mapping.outcome
  }
})
```

### Pattern 2: Streaming with Cache

Best for: Processing wallets incrementally with checkpoints

```typescript
import { CachedTokenResolver } from '@/lib/goldsky/batch-resolver'
import * as fs from 'fs'

const CACHE_FILE = 'runtime/token-cache.json'
const resolver = new CachedTokenResolver(25000)

// Load existing cache
if (fs.existsSync(CACHE_FILE)) {
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
  resolver.importCache(cache)
  console.log(`📦 Loaded ${resolver.getCacheSize()} cached tokens`)
}

// Process wallets
for (const wallet of wallets) {
  const trades = await fetchWalletTrades(wallet)

  // Extract unique tokens for this wallet
  const tokenIds = [...new Set(trades.map(t => t.tokenId))]

  // Batch fetch any uncached tokens
  await resolver.warmCache(tokenIds)

  // Transform trades (instant cache lookups)
  const transformed = await Promise.all(
    trades.map(async t => {
      const mapping = await resolver.resolveToken(t.tokenId)
      return transformTrade(t, mapping)
    })
  )

  // ... insert trades ...

  // Periodically save cache
  if (wallet_index % 100 === 0) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(resolver.exportCache()))
  }
}

// Final cache save
fs.writeFileSync(CACHE_FILE, JSON.stringify(resolver.exportCache()))
```

### Pattern 3: Pre-Warm Strategy

Best for: Maximum performance when full token list is known

```typescript
import { CachedTokenResolver } from '@/lib/goldsky/batch-resolver'

// Step 1: Get all unique tokens across entire dataset
const allUniqueTokens = await queryUniqueTokensFromGoldsky()
console.log(`Found ${allUniqueTokens.length} unique tokens`)

// Step 2: Pre-warm cache (ONE TIME COST)
const resolver = new CachedTokenResolver(25000)
console.log('🔥 Pre-warming cache...')
await resolver.warmCache(allUniqueTokens)
console.log(`✅ Cache warmed with ${resolver.getCacheSize()} tokens`)

// Step 3: Process all wallets with instant lookups
for (const wallet of wallets) {
  const trades = await fetchWalletTrades(wallet)

  // All lookups are instant (cache hit)
  const transformed = await Promise.all(
    trades.map(async t => {
      const mapping = await resolver.resolveToken(t.tokenId) // INSTANT
      return transformTrade(t, mapping)
    })
  )
}
```

---

## Performance Guidelines

### Batch Size Recommendations

| Batch Size | Use Case | Performance |
|------------|----------|-------------|
| 10,000 | Conservative, high reliability | ~1.3s per batch |
| 25,000 | **Recommended default** | ~0.5s per batch |
| 50,000 | Maximum tested | ~1.1s per batch |

### Expected Performance

- **Sequential (current):** 8.4 tokens/sec
- **Batched (25k):** 44,883 tokens/sec (5,300x faster)

### Real-World Timing

For 115M trades with unique token IDs:

| Approach | Time |
|----------|------|
| Sequential | 157 days |
| Batch per wallet | 16 hours |
| Pre-warm cache | **< 1 hour** |

---

## Error Handling

```typescript
import { batchResolveTokenIds } from '@/lib/goldsky/batch-resolver'

try {
  const result = await batchResolveTokenIds(tokenIds)

  // Check for partially failed batch
  if (result.notFound.length > 0) {
    console.warn(`⚠️  ${result.notFound.length} tokens not found`)

    // Optionally retry not found tokens
    const retryResult = await batchResolveTokenIds(result.notFound, 1000)
  }

  // Use resolved tokens
  processTokens(result.resolved)

} catch (error) {
  console.error('Batch resolution failed:', error)
  // Fallback to sequential resolution or skip wallet
}
```

---

## GraphQL Query Details

The underlying GraphQL query:

```graphql
query BatchResolveTokens($tokenIds: [String!]!) {
  tokenIdConditions(where: { id_in: $tokenIds }) {
    id
    condition {
      id
    }
    outcomeIndex
  }
}
```

### Query Features
- ✅ Supports up to 50,000 tokens per query
- ✅ Returns only found tokens (not found = omitted)
- ✅ Uses The Graph's native `id_in` filter
- ✅ Single round trip regardless of batch size

### Endpoint
```
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn
```

---

## Testing

### Run Test Suite

```bash
# Basic functionality test
npx tsx scripts/test-goldsky-batch.ts

# Performance benchmarks
npx tsx scripts/test-goldsky-batch-real.ts

# Find maximum batch size
npx tsx scripts/test-goldsky-max-batch.ts
```

### Unit Test Example

```typescript
import { batchResolveTokenIds, CachedTokenResolver } from '@/lib/goldsky/batch-resolver'

describe('Goldsky Batch Resolver', () => {
  it('resolves multiple tokens', async () => {
    const result = await batchResolveTokenIds(['1', '2', '3'])

    expect(result.resolved).toBeInstanceOf(Array)
    expect(result.notFound).toBeInstanceOf(Array)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('caches tokens', async () => {
    const resolver = new CachedTokenResolver()

    await resolver.warmCache(['1', '2', '3'])
    expect(resolver.getCacheSize()).toBeGreaterThan(0)

    const mapping = await resolver.resolveToken('1')
    expect(mapping).toBeTruthy()
  })
})
```

---

## Migration Guide

### From Sequential to Batched

**Before:**
```typescript
for (const trade of trades) {
  const tokenInfo = await resolveTokenId(trade.tokenId) // SLOW
  trade.condition_id = tokenInfo?.condition.id
}
```

**After:**
```typescript
const resolver = new CachedTokenResolver()
const tokenIds = trades.map(t => t.tokenId)
await resolver.warmCache(tokenIds) // ONE API CALL

for (const trade of trades) {
  const mapping = await resolver.resolveToken(trade.tokenId) // INSTANT
  trade.condition_id = mapping?.conditionId
}
```

### Migration Checklist

- [ ] Import `CachedTokenResolver` from `@/lib/goldsky/batch-resolver`
- [ ] Replace individual `resolveTokenId()` calls with batch resolver
- [ ] Add cache persistence (import/export)
- [ ] Update progress logging to show batch metrics
- [ ] Test with subset of wallets first
- [ ] Monitor cache hit rate and adjust batch size
- [ ] Deploy to production

---

## Troubleshooting

### "Query too complex" error
- **Solution:** Reduce batch size from 25k to 10k
- **Reason:** GraphQL server has query complexity limits

### "Rate limit exceeded"
- **Solution:** Add delay between batches (`await sleep(100)`)
- **Reason:** Too many concurrent requests

### High "not found" rate
- **Solution:** Normal - not all token IDs exist in Goldsky
- **Action:** Log not found tokens for investigation

### Cache growing too large
- **Solution:** Periodically clear cache or use LRU eviction
- **Action:** Implement cache size limit (e.g., 1M tokens max)

---

## Additional Resources

- [Goldsky Case Study](https://goldsky.com/case-studies/polymarket-goldsky)
- [Goldsky Mirror Docs](https://docs.goldsky.com/subgraph-vs-mirror)
- [The Graph GraphQL API](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/)
- [Implementation Guide](./goldsky-batch-optimization.md)
