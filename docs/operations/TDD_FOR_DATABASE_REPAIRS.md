# Test-Driven Development for Database Repairs

**Analysis Date:** 2025-11-15  
**Question:** Should we use TDD for ALL database repairs (REPAIRS #1-4)?  
**Answer:** **MIXED - Some yes, some no. Here's the breakdown.**

---

## REPAIR-BY-REPAIR ANALYSIS

### REPAIR #1: Resume Gamma Polling ❌ NO TDD

**Task:** Re-enable resolution data polling from Gamma API

**TDD Scorecard:**
| Criterion | Score | Reason |
|-----------|-------|--------|
| Logic complexity | ❌ Low | HTTP polling, cron job |
| Edge cases | ⚠️ Some | API errors, rate limits |
| Ground truth | ❌ No | Can't verify "correct" polling |
| Correctness critical | ✅ Yes | Stale data = wrong P&L |
| Repeatable | ⚠️ Partial | API changes over time |
| Well-defined | ⚠️ Partial | "Poll every hour" is vague |

**Score:** 2/6 → **NO TDD**

**Why NOT TDD:**
- This is **infrastructure/ops work**, not application logic
- No ground truth (can't test "is polling working correctly")
- Tests would be brittle (mocking HTTP, time, etc.)
- Verification is observational (check logs, check database freshness)

**Better Approach:**
```typescript
// Instead of unit tests, use monitoring/validation scripts

// validation-script.ts
async function verifyGammaPolling() {
  // Check 1: Is process running?
  const isRunning = await checkProcess('gamma-polling');
  
  // Check 2: Is data fresh?
  const lastResolution = await getLastResolutionTime();
  const isFresh = (Date.now() - lastResolution) < 2 * 60 * 60 * 1000; // 2 hours
  
  // Check 3: Any errors in logs?
  const recentErrors = await checkLogs('gamma-polling', '1h');
  
  return {
    status: isRunning && isFresh && recentErrors.length === 0 ? 'PASS' : 'FAIL',
    details: { isRunning, isFresh, errorCount: recentErrors.length }
  };
}
```

**Recommendation:**
- ✅ Write validation script (checks system state)
- ✅ Add monitoring/alerting
- ❌ Don't write unit tests

---

### REPAIR #2: CLOB Backfill ✅ COMPLETE (No Action Needed)

**Status:** Already complete at 79.16%  
**TDD Needed:** N/A  

---

### REPAIR #3: Fix ERC-1155 Token Bridge ✅ YES TDD

**Task:** Fix encoding mismatch between hex and decimal token IDs

**TDD Scorecard:**
| Criterion | Score | Reason |
|-----------|-------|--------|
| Logic complexity | ✅ High | Hex↔decimal conversion, byte ordering |
| Edge cases | ✅ Many | Different lengths, endianness, overflow |
| Ground truth | ✅ Yes | Known token pairs from gamma_markets |
| Correctness critical | ✅ Yes | Wrong mapping = wrong trades |
| Repeatable | ✅ Yes | Same input → same output |
| Well-defined | ✅ Yes | "Decimal must match hex" |

**Score:** 6/6 → **STRONG YES for TDD**

**Why YES TDD:**
- This is **transformation logic** - perfect for TDD
- Have ground truth (gamma_markets has both formats)
- Complex bit manipulation (easy to get wrong)
- Testable pure functions

**Test Examples:**
```typescript
describe('Token ID conversion', () => {
  it('should convert hex to decimal correctly', () => {
    const hex = '0xde52e5e3c44aa8a831f0e1b82d0bcadb1b25e4b4';
    const decimal = hexToDecimal(hex);
    expect(decimal).toBe('100000293804690815023609597660894660801582658691499546225810764430851148723524');
  });

  it('should handle leading zeros', () => {
    const hex = '0x00000001';
    const decimal = hexToDecimal(hex);
    expect(decimal).toBe('1');
  });

  it('should be reversible', () => {
    const original = '0xde52e5e3c44aa8a831f0e1b82d0bcadb1b25e4b4';
    const decimal = hexToDecimal(original);
    const hex = decimalToHex(decimal);
    expect(hex.toLowerCase()).toBe(original.toLowerCase());
  });

  it('should match gamma_markets token pairs', async () => {
    // Get known good pairs from gamma_markets
    const knownPairs = await getKnownTokenPairs();
    
    for (const pair of knownPairs) {
      const converted = hexToDecimal(pair.hex);
      expect(converted).toBe(pair.decimal);
    }
  });
});

describe('JOIN success', () => {
  it('should map 95%+ of transfers after fix', async () => {
    // Apply conversion
    await addDecimalColumn();
    
    // Test join
    const successRate = await testJoinSuccess();
    expect(successRate).toBeGreaterThan(0.95);
  });

  it('should match known markets', async () => {
    // Pick 10 known markets from gamma_markets
    const markets = await getSampleMarkets(10);
    
    for (const market of markets) {
      const transfers = await getTransfersForMarket(market.condition_id);
      expect(transfers.length).toBeGreaterThan(0);
    }
  });
});
```

**Recommendation:**
- ✅ Write tests FIRST for conversion logic
- ✅ Test against known good data from gamma_markets
- ✅ Validate JOIN success rate

---

### REPAIR #4: Backfill Recent Data Gap ⚠️ PARTIAL TDD

**Task:** Fill 5.5 day gap (Nov 6-11) of missing CLOB fills

**TDD Scorecard:**
| Criterion | Score | Reason |
|-----------|-------|--------|
| Logic complexity | ⚠️ Medium | Pagination, rate limiting, retry logic |
| Edge cases | ✅ Many | Timeouts, duplicates, API errors |
| Ground truth | ⚠️ Partial | Can compare to Goldsky API |
| Correctness critical | ✅ Yes | Missing trades = incomplete P&L |
| Repeatable | ⚠️ No | Historical data might change |
| Well-defined | ⚠️ Partial | "Fill the gap" - but how? |

**Score:** 3.5/6 → **PARTIAL TDD**

**Why PARTIAL:**
- The **backfill script** itself = infrastructure (no TDD)
- But **deduplication/validation logic** = application code (yes TDD)

**What TO test:**
```typescript
describe('Deduplication logic', () => {
  it('should skip existing fills', async () => {
    const existingFills = [
      { market_id: 'A', timestamp: 1000, fill_id: '1' }
    ];
    
    const newFills = [
      { market_id: 'A', timestamp: 1000, fill_id: '1' }, // Duplicate
      { market_id: 'A', timestamp: 2000, fill_id: '2' }  // New
    ];
    
    const toInsert = deduplicateFills(existingFills, newFills);
    expect(toInsert.length).toBe(1);
    expect(toInsert[0].fill_id).toBe('2');
  });

  it('should handle pagination correctly', () => {
    const pages = paginateRequests(10000, 1000); // 10k items, 1k per page
    expect(pages.length).toBe(10);
    expect(pages[0]).toEqual({ offset: 0, limit: 1000 });
    expect(pages[9]).toEqual({ offset: 9000, limit: 1000 });
  });
});

describe('Data validation', () => {
  it('should reject fills with invalid timestamps', () => {
    const fills = [
      { timestamp: Date.now() }, // Valid
      { timestamp: -1 },          // Invalid
      { timestamp: null }         // Invalid
    ];
    
    const valid = validateFills(fills);
    expect(valid.length).toBe(1);
  });

  it('should normalize condition IDs', () => {
    const fills = [
      { condition_id: '0xABC...' },
      { condition_id: '0xabc...' },
      { condition_id: 'abc...' }
    ];
    
    const normalized = normalizeFills(fills);
    expect(normalized[0].condition_id).toBe(normalized[1].condition_id);
    expect(normalized[1].condition_id).toBe(normalized[2].condition_id);
  });
});
```

**What NOT TO test:**
```typescript
// ❌ Don't test HTTP calls
it('should call Goldsky API', async () => {
  // This is infrastructure, not logic
  // Brittle, slow, depends on external service
});

// ❌ Don't test database inserts
it('should insert fills into database', async () => {
  // This is integration, not unit
  // Slow, requires test database
});
```

**Recommendation:**
- ✅ Test deduplication logic
- ✅ Test data validation/normalization
- ✅ Test pagination logic
- ❌ Don't test HTTP/database (use integration tests instead)
- ✅ Write validation script to verify backfill results

---

## SUMMARY: WHICH REPAIRS NEED TDD?

| Repair | TDD? | Why / Why Not |
|--------|------|---------------|
| #1: Gamma Polling | ❌ NO | Infrastructure/ops - use monitoring instead |
| #2: CLOB Backfill | N/A | Already complete |
| #3: ERC-1155 Bridge | ✅ YES | Pure logic, ground truth, critical correctness |
| #4: Recent Data Gap | ⚠️ PARTIAL | Test logic, not infra |

---

## GENERAL RULE: When to TDD Database Work

### ✅ YES - Write Tests First:
1. **Data transformation logic**
   - Format conversions (hex↔decimal, date parsing)
   - ID normalization
   - Deduplication algorithms
   
2. **Business logic that touches database**
   - Validation rules
   - Calculated fields
   - Aggregations with complex formulas

3. **Query builders**
   - Dynamic SQL generation
   - Filter composition
   - Parameterization

### ❌ NO - Use Validation Scripts Instead:
1. **Infrastructure/operations**
   - Polling jobs
   - Backup scripts
   - Database migrations (the ALTER TABLE itself)
   
2. **One-time backfills**
   - Historical data imports
   - Manual data fixes
   - Ad-hoc repairs

3. **External integrations**
   - HTTP API calls
   - File uploads
   - Third-party services

### ⚠️ PARTIAL - Test the Logic, Not the Plumbing:
1. **Backfill scripts**
   - ✅ Test deduplication logic
   - ❌ Don't test HTTP calls
   
2. **Migration scripts**
   - ✅ Test transformation functions
   - ❌ Don't test ALTER TABLE

3. **ETL pipelines**
   - ✅ Test extract/transform logic
   - ❌ Don't test load operations

---

## RECOMMENDED APPROACH FOR EACH REPAIR

### REPAIR #1: Gamma Polling (No TDD)
```bash
# 1. Write validation script
scripts/validate-gamma-polling.ts

# 2. Check if polling is working
npx tsx scripts/validate-gamma-polling.ts

# 3. Set up monitoring
# Add to cron: */30 * * * * npx tsx scripts/validate-gamma-polling.ts
```

### REPAIR #3: ERC-1155 Bridge (Full TDD)
```bash
# 1. Extract test fixtures from gamma_markets
scripts/extract-token-test-fixtures.ts

# 2. Write conversion tests
lib/polymarket/token-conversion.test.ts

# 3. Implement conversion logic
lib/polymarket/token-conversion.ts

# 4. Write schema migration tests
scripts/test-erc1155-migration.test.ts

# 5. Run migration
scripts/migrate-erc1155-token-ids.ts

# 6. Validate results
scripts/validate-erc1155-bridge.ts
```

### REPAIR #4: Recent Data Gap (Partial TDD)
```bash
# 1. Write tests for logic components
scripts/backfill-recent-gap.test.ts
  - deduplication
  - validation
  - normalization

# 2. Write backfill script
scripts/backfill-recent-gap.ts

# 3. Run backfill (with progress tracking)
npx tsx scripts/backfill-recent-gap.ts

# 4. Validate results
scripts/validate-recent-backfill.ts
```

---

## COMPLETE STRATEGY FOR TOMORROW

### Morning (8:00 AM - 10:00 AM): Write Tests

**Priority 1: ERC-1155 Bridge (TDD)**
```bash
# Extract test data
npx tsx scripts/extract-token-test-fixtures.ts > __tests__/fixtures/token-pairs.json

# Write conversion tests
touch lib/polymarket/token-conversion.test.ts

# Write ~20 tests for:
# - Hex to decimal conversion
# - Decimal to hex conversion  
# - Reversibility
# - Edge cases (zeros, large numbers)
# - Ground truth validation
```

**Priority 2: AMM Implementation (TDD)**
```bash
# Write ERC1155 reconstruction tests
touch lib/polymarket/erc1155-trades.test.ts

# Write ~30 tests for:
# - Transfer filtering
# - System address exclusion
# - Ground truth matching
# - Performance
```

**Priority 3: Backfill Logic (Partial TDD)**
```bash
# Write deduplication/validation tests
touch scripts/backfill-recent-gap.test.ts

# Write ~10 tests for:
# - Deduplication
# - Validation
# - Normalization
```

### Midday (10:00 AM - 2:00 PM): Implement

```bash
# Run tests in watch mode
npm test -- --watch

# Implement to make tests pass:
# 1. Token conversion (1 hour)
# 2. ERC1155 reconstruction (2 hours)
# 3. Backfill logic (1 hour)
```

### Afternoon (2:00 PM - 5:00 PM): Execute & Validate

```bash
# Execute repairs
npm run repair:erc1155-bridge
npm run repair:recent-backfill

# Run validation scripts
npm run validate:all

# Check results
npm run coverage-analysis
```

---

## VALIDATION SCRIPTS (Write These)

### 1. Validate Gamma Polling
```typescript
// scripts/validate-gamma-polling.ts
async function validateGammaPolling() {
  const lastResolution = await getLastResolution();
  const age = Date.now() - new Date(lastResolution.resolved_at).getTime();
  
  return {
    status: age < 2 * 60 * 60 * 1000 ? 'PASS' : 'FAIL',
    lastResolution: lastResolution.resolved_at,
    ageMinutes: Math.floor(age / 60000)
  };
}
```

### 2. Validate ERC-1155 Bridge
```typescript
// scripts/validate-erc1155-bridge.ts
async function validateBridge() {
  const successRate = await calculateJoinSuccessRate();
  const sampleMatches = await validateSampleMarkets(100);
  
  return {
    status: successRate > 0.95 ? 'PASS' : 'FAIL',
    successRate,
    sampleMatches
  };
}
```

### 3. Validate Recent Backfill
```typescript
// scripts/validate-recent-backfill.ts
async function validateBackfill() {
  const dailyCounts = await getFillCountsByDay('2024-11-06', '2024-11-14');
  const hasGaps = dailyCounts.some(d => d.count === 0);
  
  return {
    status: !hasGaps ? 'PASS' : 'FAIL',
    dailyCounts,
    totalFills: dailyCounts.reduce((sum, d) => sum + d.count, 0)
  };
}
```

---

## FINAL ANSWER

**For database repairs:**

1. **REPAIR #1 (Gamma Polling):** ❌ No TDD - Use validation scripts
2. **REPAIR #3 (ERC-1155):** ✅ Full TDD - Perfect use case
3. **REPAIR #4 (Backfill):** ⚠️ Partial TDD - Test logic, not infrastructure

**For AMM implementation:** ✅ Full TDD - As discussed earlier

**Overall strategy:**
- 60% TDD (transformation logic, business rules)
- 40% validation scripts (infrastructure, ops)

**The engineer's advice is PARTIALLY correct:**
- ✅ YES for application logic (AMM, conversions)
- ❌ NO for infrastructure (polling, backfills)
- ⚠️ MIXED for data operations (test the logic, validate the results)

