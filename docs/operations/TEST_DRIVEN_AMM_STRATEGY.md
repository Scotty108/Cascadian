# Test-Driven Development Strategy for AMM Implementation

**Analysis Date:** 2025-11-15  
**Question:** Should we write unit tests first, then implement?  
**Answer:** **YES - This is an IDEAL use case for test-driven development**

---

## Why This is Perfect for TDD

### 1. **We Have Ground Truth** ✅
```
CLOB fills = verified, accurate trade data
ERC1155 reconstruction = must match CLOB for same markets
```

We can write tests that compare ERC1155 reconstruction against known CLOB results.

### 2. **Complex Logic with Edge Cases** ✅
```
- Filter mints (from 0x000...)
- Filter burns (to 0x000...)
- Exclude system addresses
- Detect trade direction (buy vs sell)
- Calculate prices (or mark as unavailable)
- Handle markets with zero trades
- Handle markets with 1000+ trades
```

Each of these is a testable behavior.

### 3. **Critical Correctness Required** ✅
```
Financial data accuracy = non-negotiable
User sees wrong P&L = loss of trust
```

Tests catch bugs before they hit production.

### 4. **Clear Success Criteria** ✅
```
✅ ERC1155 trade count matches CLOB for same market
✅ No system addresses in results
✅ Zero-trade markets return empty array
✅ High-volume markets perform < 500ms
```

---

## Validation: When to Use TDD

### ✅ USE TDD When:
1. **Logic complexity** - Multiple conditional branches
2. **Edge cases** - Known failure modes to prevent
3. **Ground truth exists** - Can compare against known-good data
4. **Correctness critical** - Bugs have serious consequences
5. **Repeatable** - Same inputs → same outputs
6. **Well-defined requirements** - Clear spec of what "correct" means

### ❌ DON'T Use TDD When:
1. **Exploratory work** - Don't know what you're building yet
2. **UI/UX** - Subjective "correctness"
3. **One-off scripts** - Won't be maintained
4. **Research** - Learning what's possible
5. **Integration testing infrastructure** - Complex setup overhead

---

## Our AMM Implementation: TDD Scorecard

| Criterion | Score | Evidence |
|-----------|-------|----------|
| Logic complexity | ✅ High | Transfer filtering, direction detection |
| Edge cases | ✅ Many | Mints, burns, system addresses, zero trades |
| Ground truth | ✅ Yes | CLOB fills for 79% of markets |
| Correctness critical | ✅ Yes | Financial data accuracy |
| Repeatable | ✅ Yes | Same market → same trades |
| Well-defined | ✅ Yes | Clear spec from architecture |

**Verdict:** 6/6 → **STRONG YES for TDD**

---

## Recommended Test Strategy

### Phase 1: Write Tests FIRST (2-3 hours tomorrow morning)

#### Test Suite 1: ERC1155 Transfer Filtering
```typescript
describe('filterTradeTransfers', () => {
  it('should exclude mints (from zero address)', () => {
    const transfers = [
      { from: '0x0000000000000000000000000000000000000000', to: '0xabc...', value: '100' },
      { from: '0xdef...', to: '0xghi...', value: '100' }
    ];
    const result = filterTradeTransfers(transfers);
    expect(result.length).toBe(1);
    expect(result[0].from).toBe('0xdef...');
  });

  it('should exclude burns (to zero address)', () => {
    const transfers = [
      { from: '0xabc...', to: '0x0000000000000000000000000000000000000000', value: '100' },
      { from: '0xdef...', to: '0xghi...', value: '100' }
    ];
    const result = filterTradeTransfers(transfers);
    expect(result.length).toBe(1);
    expect(result[0].to).toBe('0xghi...');
  });

  it('should exclude known system addresses', () => {
    const transfers = [
      { from: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', to: '0xabc...', value: '100' }, // CTF Exchange
      { from: '0xdef...', to: '0xghi...', value: '100' }
    ];
    const result = filterTradeTransfers(transfers);
    expect(result.length).toBe(1);
    expect(result[0].from).toBe('0xdef...');
  });
});
```

#### Test Suite 2: Market Coverage Validation
```typescript
describe('getMarketTrades', () => {
  it('should return CLOB data for markets with orderbook activity', async () => {
    // Use a known high-volume CLOB market
    const conditionId = '0x...'; // From overnight analysis
    const trades = await getMarketTrades(conditionId);
    
    // Should use CLOB source
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0].source).toBe('clob');
  });

  it('should return empty array for zero-trade markets', async () => {
    // Use our known zero-trade test market
    const conditionId = '0x54625984ec20476ea88ceeaa93c1e38f3bccdd038adf391744a9a0bc1222ff9e';
    const trades = await getMarketTrades(conditionId);
    
    expect(trades).toEqual([]);
  });

  it('should fall back to ERC1155 for AMM-only markets', async () => {
    // Use market from overnight analysis (AMM-Only Test Markets)
    const conditionId = '0x...'; // First AMM-only market found
    const trades = await getMarketTrades(conditionId);
    
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0].source).toBe('erc1155');
  });
});
```

#### Test Suite 3: Ground Truth Validation
```typescript
describe('ERC1155 vs CLOB accuracy', () => {
  it('should match CLOB trade count for same market', async () => {
    // Pick a market that has both CLOB and ERC1155 data
    const conditionId = '0x...';
    
    const clobTrades = await getCLOBTrades(conditionId);
    const erc1155Trades = await getERC1155Trades(conditionId);
    
    // Counts should be within tolerance (ERC1155 might have more due to internal transfers)
    const tolerance = 0.1; // 10% tolerance
    expect(erc1155Trades.length).toBeGreaterThanOrEqual(clobTrades.length * (1 - tolerance));
    expect(erc1155Trades.length).toBeLessThanOrEqual(clobTrades.length * (1 + tolerance));
  });

  it('should have same traders as CLOB for orderbook markets', async () => {
    const conditionId = '0x...';
    
    const clobTrades = await getCLOBTrades(conditionId);
    const erc1155Trades = await getERC1155Trades(conditionId);
    
    const clobTraders = new Set([
      ...clobTrades.map(t => t.maker),
      ...clobTrades.map(t => t.taker)
    ]);
    
    const erc1155Traders = new Set([
      ...erc1155Trades.map(t => t.from_address),
      ...erc1155Trades.map(t => t.to_address)
    ]);
    
    // Should have significant overlap (not exact due to AMM trades)
    const overlap = [...clobTraders].filter(t => erc1155Traders.has(t));
    expect(overlap.length / clobTraders.size).toBeGreaterThan(0.8); // 80% overlap
  });
});
```

#### Test Suite 4: Performance Requirements
```typescript
describe('Performance benchmarks', () => {
  it('should query CLOB markets in < 200ms', async () => {
    const start = Date.now();
    await getMarketTrades('0x...'); // CLOB market
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(200);
  });

  it('should query ERC1155 markets in < 500ms', async () => {
    const start = Date.now();
    await getMarketTrades('0x...'); // AMM-only market
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });

  it('should handle high-volume markets without timeout', async () => {
    // Use highest-volume market from overnight analysis
    const conditionId = '0x...';
    
    const promise = getMarketTrades(conditionId);
    await expect(promise).resolves.toBeDefined();
  });
});
```

#### Test Suite 5: Edge Cases
```typescript
describe('Edge cases', () => {
  it('should handle markets with no token mappings', async () => {
    // Market that exists in gamma_markets but not ctf_token_map
    const conditionId = '0x...';
    
    const trades = await getMarketTrades(conditionId);
    expect(trades).toEqual([]);
  });

  it('should normalize condition IDs correctly', async () => {
    const variations = [
      '0x54625984...',  // With 0x
      '54625984...',    // Without 0x
      '0X54625984...',  // Uppercase 0X
    ];
    
    const results = await Promise.all(
      variations.map(id => getMarketTrades(id))
    );
    
    // All variations should return same result
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it('should handle malformed condition IDs gracefully', async () => {
    const invalid = ['', '0x', 'not-a-hex', '0x123']; // Too short
    
    for (const id of invalid) {
      const trades = await getMarketTrades(id);
      expect(trades).toEqual([]);
    }
  });
});
```

---

### Phase 2: Implement to Pass Tests (4-6 hours)

**Process:**
1. Run tests (all fail initially - RED)
2. Implement smallest feature to pass one test (GREEN)
3. Refactor if needed (REFACTOR)
4. Repeat for next test

**Advantages:**
- Clear progress tracking (X/Y tests passing)
- Catch bugs immediately
- Prevents scope creep
- Forces clean interfaces

---

### Phase 3: Integration Tests (1-2 hours)

After unit tests pass, add integration tests:

```typescript
describe('Full coverage integration', () => {
  it('should achieve 90%+ market coverage', async () => {
    // Query 1000 random markets
    const markets = await getRandomMarkets(1000);
    
    let covered = 0;
    for (const market of markets) {
      const trades = await getMarketTrades(market.condition_id);
      if (trades.length > 0 || market.truly_zero_trades) {
        covered++;
      }
    }
    
    const coverage = covered / markets.length;
    expect(coverage).toBeGreaterThan(0.90);
  });
});
```

---

## Alternative: Test-After Approach

### If you prefer implementation-first:

**Pros:**
- Faster initial progress
- More flexible/exploratory
- Good for prototyping

**Cons:**
- Tests influenced by implementation (might miss edge cases)
- Harder to change implementation later
- Bugs discovered late

**Verdict:** Not recommended for this task (too critical)

---

## Recommended File Structure

```
lib/polymarket/
  erc1155-trades.ts           # Implementation
  erc1155-trades.test.ts      # Unit tests
  hybrid-data-service.ts      # Implementation
  hybrid-data-service.test.ts # Unit tests

scripts/
  test-amm-implementation.ts  # Integration test runner

__tests__/
  fixtures/
    clob-markets.json         # Known CLOB markets for testing
    amm-markets.json          # AMM-only markets (from overnight)
    zero-trade-markets.json   # Known empty markets
```

---

## How to Use This Tomorrow

### Morning (8:00 AM - 11:00 AM): Write Tests
```bash
# 1. Extract test fixtures from overnight analysis
cat tmp/overnight-analysis.json | jq '.analyses[] | select(.name == "AMM-Only Test Markets")' > __tests__/fixtures/amm-markets.json

# 2. Create test files
touch lib/polymarket/erc1155-trades.test.ts
touch lib/polymarket/hybrid-data-service.test.ts

# 3. Write all test suites (copy from this doc)
# 4. Run tests (all fail) - this is expected
npm test

# ✅ Goal: ~30-40 failing tests defined
```

### Midday (11:00 AM - 3:00 PM): Implement
```bash
# 5. Implement erc1155-trades.ts
# 6. Watch tests turn green one by one
npm test --watch

# ✅ Goal: All unit tests passing
```

### Afternoon (3:00 PM - 5:00 PM): Integration
```bash
# 7. Write integration tests
# 8. Test against real database
# 9. Performance optimization

# ✅ Goal: 90%+ coverage validated
```

---

## Cost-Benefit Analysis

### Costs:
- **Time:** +2-3 hours upfront (writing tests)
- **Complexity:** Need to think through edge cases before coding
- **Setup:** Test fixtures, test infrastructure

### Benefits:
- **Confidence:** Know it works before deploying
- **Debugging:** Failing tests pinpoint exact issue
- **Refactoring:** Can change implementation safely
- **Documentation:** Tests show how code should behave
- **Regression prevention:** Future changes won't break existing behavior

**ROI:** Extremely high for this use case

---

## Final Recommendation

### ✅ YES - Use Test-Driven Development

**Specific Strategy:**
1. **Morning:** Write tests using ground truth from overnight analysis
2. **Midday:** Implement to pass tests (TDD red-green-refactor)
3. **Afternoon:** Integration tests + performance validation

**Why:**
- We have perfect ground truth (CLOB data)
- Logic is complex with many edge cases
- Financial accuracy is critical
- Will save debugging time later

**Agent Assignment:**
```
Tomorrow's prompt to agent:
"We're implementing ERC1155 trade reconstruction. Tests are already written 
in lib/polymarket/*.test.ts. Your task: Make all tests pass. Do NOT modify 
the tests unless they contain errors. Focus on implementation only."
```

This gives the agent:
- Clear success criteria (green tests)
- Boundary constraints (can't change requirements)
- Measurable progress (X/Y tests passing)

---

## What Makes This Different from Today's Work

**Today (Investigation):**
- Exploratory - didn't know what we'd find
- Research - tested APIs, schemas
- No clear "correct" answer
- ❌ TDD would have been wrong approach

**Tomorrow (Implementation):**
- Well-defined - know exactly what to build
- Clear spec - match CLOB behavior for ERC1155
- Verifiable correctness - ground truth exists
- ✅ TDD is perfect approach

---

**Conclusion:** The engineer's advice is **100% correct for tomorrow's task**. Write tests first, then assign agent to pass them.

