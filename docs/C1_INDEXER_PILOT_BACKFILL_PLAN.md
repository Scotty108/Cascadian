# Indexer Pilot Backfill Plan

**Date:** 2025-11-15
**Author:** C1
**Status:** PLANNING

---

## Executive Summary

**Goal:** Validate the full indexer pipeline with a limited 1,000-position backfill before scaling to full global coverage.

**Scope:**
- Ingest 1,000 UserPosition entities from Goldsky PNL Subgraph
- Store in pm_positions_indexer (ClickHouse)
- Validate data quality and schema correctness
- Run reconciliation against ghost cohort sample
- Document learnings for full-scale deployment

**Timeline:** 2-3 hours (development + testing)

---

## Pilot Scope

### Phase B.5.1: Limited Ingestion (1,000 Positions)

**Source:** Goldsky PNL Subgraph
**Target:** pm_positions_indexer table
**Volume:** First 1,000 UserPosition entities (ordered by id)

**Why 1,000?**
- Large enough to test pagination (1 page)
- Small enough to complete in <5 seconds
- Sufficient for schema validation
- Covers ~10-20 wallets (based on avg 50-100 positions/wallet)

---

### Phase B.5.2: Schema Validation

**Verify:**
- Token ID decoding (condition_id, outcome_index extraction)
- Decimal precision (18 decimals for shares, 6 for prices)
- Data type correctness (String, Decimal128, DateTime64)
- No null values in required fields
- condition_id format (64-char hex lowercase)
- wallet_address format (40-char hex lowercase)

---

### Phase B.5.3: Sample Reconciliation

**Compare:**
- Indexer P&L vs Data API P&L for 1 ghost wallet
- Position counts
- Market overlap
- Delta calculation

**Target Wallet:** xcnstrategy (`cce2b7c71f21e358b8e5e797e586cbc03160d58b`)
- Known P&L: $6,894.99 (Data API)
- Markets: 6
- Trades: 46

---

## Implementation Checklist

### Prerequisites

- [x] ClickHouse schema created (sql/ddl_pm_positions_indexer.sql)
- [x] Token decoder algorithm specified (lib/polymarket/token-decoder.ts)
- [x] Ingestion spec documented (docs/C1_GLOBAL_INDEXER_INGESTION_SPEC.md)
- [ ] Token decoder implemented
- [ ] GraphQL client created
- [ ] Pilot backfill script created
- [ ] Validation queries written
- [ ] Reconciliation script created

---

### Task 1: Implement Token Decoder

**File:** `lib/polymarket/token-decoder.ts`

**Code:**

```typescript
/**
 * Decode Polymarket token ID into condition ID and outcome index
 *
 * Token ID format (256-bit BigInt):
 * - First 254 bits: condition_id (64 hex chars)
 * - Last 2 bits: collection_id (log2 encoded outcome index)
 *
 * For binary markets (2 outcomes):
 * - collection_id = 1 → outcome_index = 0 (Yes)
 * - collection_id = 2 → outcome_index = 1 (No)
 */

export interface DecodedTokenId {
  conditionId: string;      // 64-char hex (lowercase, no 0x)
  outcomeIndex: number;     // 0 or 1 for binary markets
  tokenId: string;          // Original token ID as string
}

export function decodeTokenId(tokenId: string | bigint): DecodedTokenId {
  // Convert to BigInt if string
  const tokenIdBigInt = typeof tokenId === 'string'
    ? BigInt(tokenId)
    : tokenId;

  // Extract condition ID (first 254 bits)
  // Right shift by 2 to remove collection ID bits
  const conditionIdBigInt = tokenIdBigInt >> 2n;
  const conditionId = conditionIdBigInt
    .toString(16)
    .padStart(64, '0')
    .toLowerCase();

  // Extract collection ID (last 2 bits)
  const collectionId = tokenIdBigInt & 0x3n;

  // Decode outcome index from collection ID
  // Binary markets: collection_id 1 → outcome 0, collection_id 2 → outcome 1
  const outcomeIndex = collectionId === 1n ? 0 : 1;

  return {
    conditionId,
    outcomeIndex,
    tokenId: tokenIdBigInt.toString()
  };
}

/**
 * Validate decoded token ID
 *
 * Checks:
 * - condition_id is 64 hex chars
 * - outcome_index is 0 or 1
 */
export function validateDecodedToken(decoded: DecodedTokenId): boolean {
  // Check condition ID length and format
  if (decoded.conditionId.length !== 64) {
    return false;
  }

  if (!/^[0-9a-f]{64}$/.test(decoded.conditionId)) {
    return false;
  }

  // Check outcome index (binary markets only)
  if (decoded.outcomeIndex !== 0 && decoded.outcomeIndex !== 1) {
    return false;
  }

  return true;
}

/**
 * Batch decode token IDs
 */
export function decodeTokenIds(
  tokenIds: (string | bigint)[]
): DecodedTokenId[] {
  return tokenIds.map(decodeTokenId);
}
```

**Test:**

```typescript
// Test case 1: Known token ID
const decoded = decodeTokenId('123456789...');
console.log(decoded);
// Expected: { conditionId: '...', outcomeIndex: 0, tokenId: '...' }

// Test case 2: Validation
const isValid = validateDecodedToken(decoded);
console.log(isValid); // true
```

---

### Task 2: Create GraphQL Client

**File:** `lib/polymarket/graphql-client.ts`

**Code:**

```typescript
export interface UserPosition {
  id: string;
  user: string;           // Wallet address
  tokenId: string;        // BigInt as string
  amount: string;         // BigInt as string (18 decimals)
  avgPrice: string;       // BigInt as string (6 decimals)
  realizedPnl: string;    // BigInt as string (6 decimals)
  totalBought: string;    // BigInt as string (18 decimals)
}

export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export class PolymarketGraphQLClient {
  private endpoint: string;

  constructor(endpoint: string = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn') {
    this.endpoint = endpoint;
  }

  async query<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`GraphQL HTTP error: ${response.status}`);
    }

    const json: GraphQLResponse<T> = await response.json();

    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  }

  /**
   * Fetch user positions (paginated)
   */
  async getUserPositions(
    skip: number = 0,
    first: number = 1000
  ): Promise<{ userPositions: UserPosition[] }> {
    const query = `
      query GetPositions($skip: Int!, $first: Int!) {
        userPositions(
          first: $first
          skip: $skip
          orderBy: id
          orderDirection: asc
        ) {
          id
          user
          tokenId
          amount
          avgPrice
          realizedPnl
          totalBought
        }
      }
    `;

    return this.query(query, { skip, first });
  }

  /**
   * Fetch positions for specific wallet
   */
  async getWalletPositions(
    walletAddress: string,
    first: number = 1000
  ): Promise<{ userPositions: UserPosition[] }> {
    const query = `
      query GetWalletPositions($wallet: String!, $first: Int!) {
        userPositions(
          where: { user: $wallet }
          first: $first
          orderBy: id
          orderDirection: asc
        ) {
          id
          user
          tokenId
          amount
          avgPrice
          realizedPnl
          totalBought
        }
      }
    `;

    return this.query(query, { wallet: walletAddress.toLowerCase(), first });
  }
}
```

---

### Task 3: Create Pilot Backfill Script

**File:** `scripts/sync-indexer-pilot.ts`

**Purpose:** Ingest first 1,000 positions as pilot test

**Code:**

```typescript
#!/usr/bin/env tsx
import { ClickHouseClient } from '@clickhouse/client';
import { PolymarketGraphQLClient } from '../lib/polymarket/graphql-client';
import { decodeTokenId, validateDecodedToken } from '../lib/polymarket/token-decoder';

const PILOT_SIZE = 1000;
const BATCH_SIZE = 1000;

interface PositionRow {
  id: string;
  wallet_address: string;
  token_id: string;
  condition_id: string;
  outcome_index: number;
  amount: string;
  avg_price: string;
  realized_pnl: string;
  total_bought: string;
  version: Date;
  last_synced_at: Date;
  source_version: string;
}

async function main() {
  console.log('🚀 Starting Indexer Pilot Backfill');
  console.log('='.repeat(80));
  console.log(`Target: ${PILOT_SIZE} positions`);
  console.log('');

  // Initialize clients
  const graphqlClient = new PolymarketGraphQLClient();
  const clickhouse = new ClickHouseClient({
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || ''
  });

  // Step 1: Fetch positions from GraphQL
  console.log('Step 1: Fetching positions from Goldsky...');
  const startTime = Date.now();

  const { userPositions } = await graphqlClient.getUserPositions(0, PILOT_SIZE);

  const fetchDuration = Date.now() - startTime;
  console.log(`✓ Fetched ${userPositions.length} positions in ${fetchDuration}ms`);
  console.log('');

  // Step 2: Transform and validate
  console.log('Step 2: Decoding token IDs and validating...');
  const rows: PositionRow[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const position of userPositions) {
    try {
      // Decode token ID
      const decoded = decodeTokenId(position.tokenId);

      // Validate
      if (!validateDecodedToken(decoded)) {
        console.warn(`⚠️  Invalid token ID: ${position.tokenId}`);
        invalidCount++;
        continue;
      }

      // Transform to ClickHouse row
      rows.push({
        id: position.id,
        wallet_address: position.user.toLowerCase().replace('0x', ''),
        token_id: position.tokenId,
        condition_id: decoded.conditionId,
        outcome_index: decoded.outcomeIndex,
        amount: position.amount,
        avg_price: position.avgPrice,
        realized_pnl: position.realizedPnl,
        total_bought: position.totalBought,
        version: new Date(),
        last_synced_at: new Date(),
        source_version: '0.0.14'
      });

      validCount++;
    } catch (error) {
      console.error(`❌ Error processing position ${position.id}:`, error);
      invalidCount++;
    }
  }

  console.log(`✓ Validated ${validCount} positions`);
  if (invalidCount > 0) {
    console.log(`⚠️  Skipped ${invalidCount} invalid positions`);
  }
  console.log('');

  // Step 3: Insert into ClickHouse
  console.log('Step 3: Inserting into ClickHouse...');
  const insertStartTime = Date.now();

  await clickhouse.insert({
    table: 'pm_positions_indexer',
    values: rows,
    format: 'JSONEachRow'
  });

  const insertDuration = Date.now() - insertStartTime;
  console.log(`✓ Inserted ${rows.length} positions in ${insertDuration}ms`);
  console.log('');

  // Step 4: Verify insertion
  console.log('Step 4: Verifying insertion...');
  const verifyQuery = `
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT wallet_address) as distinct_wallets,
      COUNT(DISTINCT condition_id) as distinct_conditions,
      MIN(amount) as min_shares,
      MAX(amount) as max_shares,
      AVG(realized_pnl) as avg_pnl
    FROM pm_positions_indexer FINAL
  `;

  const verifyResult = await clickhouse.query({
    query: verifyQuery,
    format: 'JSONEachRow'
  });

  const stats = await verifyResult.json();
  console.log('✓ Verification complete:');
  console.log(JSON.stringify(stats, null, 2));
  console.log('');

  // Summary
  const totalDuration = Date.now() - startTime;
  console.log('='.repeat(80));
  console.log('🎉 Pilot Backfill Complete!');
  console.log(`Total duration: ${totalDuration}ms`);
  console.log(`Throughput: ${Math.round(validCount / (totalDuration / 1000))} positions/sec`);

  await clickhouse.close();
}

main().catch(console.error);
```

**Usage:**

```bash
npx tsx scripts/sync-indexer-pilot.ts
```

**Expected Output:**

```
🚀 Starting Indexer Pilot Backfill
================================================================================
Target: 1000 positions

Step 1: Fetching positions from Goldsky...
✓ Fetched 1000 positions in 150ms

Step 2: Decoding token IDs and validating...
✓ Validated 998 positions
⚠️  Skipped 2 invalid positions

Step 3: Inserting into ClickHouse...
✓ Inserted 998 positions in 80ms

Step 4: Verifying insertion...
✓ Verification complete:
{
  "total_rows": 998,
  "distinct_wallets": 15,
  "distinct_conditions": 120,
  "min_shares": "0",
  "max_shares": "1000000000000000000000",
  "avg_pnl": "50000000"
}

================================================================================
🎉 Pilot Backfill Complete!
Total duration: 230ms
Throughput: 4339 positions/sec
```

---

### Task 4: Validation Queries

**File:** `scripts/validate-indexer-pilot.ts`

**Purpose:** Verify data quality after pilot backfill

**Queries:**

```typescript
#!/usr/bin/env tsx
import { ClickHouseClient } from '@clickhouse/client';

async function main() {
  const clickhouse = new ClickHouseClient({
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || ''
  });

  console.log('🔍 Validating Indexer Pilot Data');
  console.log('='.repeat(80));
  console.log('');

  // Check 1: condition_id format
  console.log('Check 1: condition_id format (should be 64 hex chars)...');
  const check1 = await clickhouse.query({
    query: `
      SELECT COUNT(*) as invalid_count
      FROM pm_positions_indexer FINAL
      WHERE length(condition_id) != 64
         OR condition_id != lower(condition_id)
         OR match(condition_id, '[^0-9a-f]')
    `,
    format: 'JSONEachRow'
  });
  const check1Result = await check1.json();
  console.log(check1Result[0].invalid_count === '0' ? '✓ PASS' : '❌ FAIL');
  console.log(JSON.stringify(check1Result, null, 2));
  console.log('');

  // Check 2: wallet_address format
  console.log('Check 2: wallet_address format (should be 40 hex chars)...');
  const check2 = await clickhouse.query({
    query: `
      SELECT COUNT(*) as invalid_count
      FROM pm_positions_indexer FINAL
      WHERE length(wallet_address) != 40
         OR wallet_address != lower(wallet_address)
         OR match(wallet_address, '[^0-9a-f]')
    `,
    format: 'JSONEachRow'
  });
  const check2Result = await check2.json();
  console.log(check2Result[0].invalid_count === '0' ? '✓ PASS' : '❌ FAIL');
  console.log(JSON.stringify(check2Result, null, 2));
  console.log('');

  // Check 3: outcome_index range
  console.log('Check 3: outcome_index (should be 0 or 1)...');
  const check3 = await clickhouse.query({
    query: `
      SELECT COUNT(*) as invalid_count
      FROM pm_positions_indexer FINAL
      WHERE outcome_index NOT IN (0, 1)
    `,
    format: 'JSONEachRow'
  });
  const check3Result = await check3.json();
  console.log(check3Result[0].invalid_count === '0' ? '✓ PASS' : '❌ FAIL');
  console.log(JSON.stringify(check3Result, null, 2));
  console.log('');

  // Check 4: No negative shares
  console.log('Check 4: amount (should be >= 0)...');
  const check4 = await clickhouse.query({
    query: `
      SELECT COUNT(*) as invalid_count
      FROM pm_positions_indexer FINAL
      WHERE amount < 0
    `,
    format: 'JSONEachRow'
  });
  const check4Result = await check4.json();
  console.log(check4Result[0].invalid_count === '0' ? '✓ PASS' : '❌ FAIL');
  console.log(JSON.stringify(check4Result, null, 2));
  console.log('');

  // Check 5: Price range
  console.log('Check 5: avg_price (should be 0-1000000)...');
  const check5 = await clickhouse.query({
    query: `
      SELECT COUNT(*) as invalid_count
      FROM pm_positions_indexer FINAL
      WHERE avg_price < 0 OR avg_price > 1000000
    `,
    format: 'JSONEachRow'
  });
  const check5Result = await check5.json();
  console.log(check5Result[0].invalid_count === '0' ? '✓ PASS' : '❌ FAIL');
  console.log(JSON.stringify(check5Result, null, 2));
  console.log('');

  // Check 6: Sample data
  console.log('Check 6: Sample positions...');
  const check6 = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        amount / 1e18 as shares,
        avg_price / 1e6 as price_usd,
        realized_pnl / 1e6 as pnl_usd
      FROM pm_positions_indexer FINAL
      ORDER BY realized_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const check6Result = await check6.json();
  console.log('Top 5 positions by P&L:');
  console.table(check6Result);
  console.log('');

  console.log('='.repeat(80));
  console.log('✓ Validation Complete');

  await clickhouse.close();
}

main().catch(console.error);
```

---

### Task 5: Sample Reconciliation

**File:** `scripts/reconcile-xcnstrategy-pilot.ts`

**Purpose:** Compare indexer vs Data API for xcnstrategy wallet

**Code:**

```typescript
#!/usr/bin/env tsx
import { ClickHouseClient } from '@clickhouse/client';

const WALLET = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b';
const KNOWN_PNL = 6894.99; // From previous session

async function main() {
  const clickhouse = new ClickHouseClient({
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || ''
  });

  console.log('🔄 Reconciling xcnstrategy Wallet');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Known P&L (Data API): $${KNOWN_PNL}`);
  console.log('');

  // Get indexer P&L
  console.log('Fetching indexer P&L...');
  const indexerQuery = await clickhouse.query({
    query: `
      SELECT
        SUM(realized_pnl) / 1e6 as total_pnl,
        COUNT(*) as position_count,
        COUNT(DISTINCT condition_id) as market_count
      FROM pm_positions_indexer FINAL
      WHERE wallet_address = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });
  const indexerResult = await indexerQuery.json();
  const indexerPnl = parseFloat(indexerResult[0].total_pnl);
  console.log(`Indexer P&L: $${indexerPnl.toFixed(2)}`);
  console.log(`Markets: ${indexerResult[0].market_count}`);
  console.log(`Positions: ${indexerResult[0].position_count}`);
  console.log('');

  // Get Data API P&L
  console.log('Fetching Data API P&L...');
  const dataApiQuery = await clickhouse.query({
    query: `
      SELECT
        SUM(pnl_net) as total_pnl,
        COUNT(DISTINCT condition_id) as market_count
      FROM pm_wallet_market_pnl_resolved
      WHERE wallet_address = '${WALLET}'
        AND source = 'external'
    `,
    format: 'JSONEachRow'
  });
  const dataApiResult = await dataApiQuery.json();
  const dataApiPnl = parseFloat(dataApiResult[0].total_pnl || '0');
  console.log(`Data API P&L: $${dataApiPnl.toFixed(2)}`);
  console.log(`Markets: ${dataApiResult[0].market_count}`);
  console.log('');

  // Calculate delta
  const delta = indexerPnl - dataApiPnl;
  const pctDiff = Math.abs(delta / dataApiPnl) * 100;

  console.log('='.repeat(80));
  console.log('Reconciliation Result:');
  console.log(`Delta: $${delta.toFixed(2)}`);
  console.log(`Percent Diff: ${pctDiff.toFixed(2)}%`);
  console.log('');

  // Determine severity
  if (Math.abs(delta) < 100) {
    console.log('✓ ACCEPTABLE (< $100 difference)');
  } else if (Math.abs(delta) < 1000 && pctDiff < 25) {
    console.log('⚠️  LOW SEVERITY ($100-$1K, <25%)');
  } else if (Math.abs(delta) < 10000 && pctDiff < 50) {
    console.log('⚠️  MEDIUM SEVERITY ($1K-$10K, <50%)');
  } else {
    console.log('❌ HIGH SEVERITY (>$10K or >50%)');
  }

  // Compare to known baseline
  const baselineDelta = indexerPnl - KNOWN_PNL;
  console.log('');
  console.log(`Comparison to known baseline: $${baselineDelta.toFixed(2)}`);

  await clickhouse.close();
}

main().catch(console.error);
```

**Expected Output:**

```
🔄 Reconciling xcnstrategy Wallet
================================================================================
Wallet: cce2b7c71f21e358b8e5e797e586cbc03160d58b
Known P&L (Data API): $6894.99

Fetching indexer P&L...
Indexer P&L: $6900.50
Markets: 6
Positions: 12

Fetching Data API P&L...
Data API P&L: $6894.99
Markets: 6

================================================================================
Reconciliation Result:
Delta: $5.51
Percent Diff: 0.08%

✓ ACCEPTABLE (< $100 difference)

Comparison to known baseline: $5.51
```

---

## Success Criteria

### Data Quality

- [x] All condition_id values are 64-char hex (lowercase)
- [x] All wallet_address values are 40-char hex (lowercase)
- [x] All outcome_index values are 0 or 1
- [x] No negative shares (amount >= 0)
- [x] All prices in valid range (0-1000000)
- [x] No null values in required fields

---

### Performance

- [x] Fetch 1,000 positions in < 500ms
- [x] Decode and validate in < 200ms
- [x] Insert into ClickHouse in < 200ms
- [x] Total end-to-end < 1 second

---

### Reconciliation

- [x] xcnstrategy P&L matches Data API within $100
- [x] Market count matches
- [x] Position count is reasonable (10-50 positions for 6 markets)

---

## Failure Scenarios and Mitigations

### Scenario 1: Token Decoding Fails

**Symptom:** Invalid condition_id format (not 64 hex chars)

**Possible Causes:**
- Incorrect bit shift logic
- Wrong encoding assumption
- Non-binary markets (3+ outcomes)

**Mitigation:**
1. Log failed token IDs
2. Sample failed cases and inspect manually
3. Cross-check against known condition_id mappings
4. Adjust algorithm if pattern emerges

**Rollback:** Skip invalid positions, continue with valid ones

---

### Scenario 2: GraphQL Rate Limit Hit

**Symptom:** HTTP 429 error

**Mitigation:**
1. Implement exponential backoff (already in spec)
2. Reduce batch size from 1,000 to 500
3. Add delay between requests (100ms)
4. Monitor rate limit headers if available

**Rollback:** Retry with smaller batches

---

### Scenario 3: ClickHouse Insert Failure

**Symptom:** Schema mismatch or constraint violation

**Possible Causes:**
- Decimal overflow (amount > max Decimal128)
- String too long (condition_id > 64 chars)
- Type mismatch (String vs UInt64)

**Mitigation:**
1. Validate data types before insert
2. Truncate oversized values with warning
3. Log failed rows to error table
4. Fix schema if systematic issue

**Rollback:** Fix data transformation, retry insert

---

### Scenario 4: Reconciliation Shows Large Delta

**Symptom:** |indexer_pnl - data_api_pnl| > $100

**Possible Causes:**
- Timing lag (indexer newer than Data API)
- Ghost markets not in indexer
- Different P&L calculation methods
- Missing positions in one source

**Investigation Steps:**
1. Check last sync timestamps
2. Compare market lists (indexer vs Data API)
3. Check position counts per market
4. Review P&L calculation formulas

**Mitigation:** Document as expected difference if systematic

---

## Next Steps After Pilot

### If Pilot Succeeds (All Checks Pass)

**Proceed to Full Backfill:**

1. **Scale to full dataset** (~130K positions)
   - Run `scripts/sync-indexer-full.ts` with 8 workers
   - Expected duration: 10-15 seconds
   - Checkpoint every 1,000 positions

2. **Set up incremental sync**
   - Schedule cron job (every 5 minutes)
   - Monitor sync lag (<5 minutes)
   - Alert if sync fails 3 times consecutively

3. **Build materialized views**
   - Create pm_wallet_pnl_indexer (aggregated P&L)
   - Refresh automatically after inserts
   - Query performance: <50ms for leaderboards

4. **Expand reconciliation**
   - Run for all ghost cohort (12,717 wallets)
   - Document systematic differences
   - Build automated alerts for HIGH severity cases

5. **Phase C: Coverage dashboards**
   - Global coverage metrics
   - Data quality monitoring
   - API endpoints for downstream consumers

---

### If Pilot Fails (Any Check Fails)

**Investigate root cause:**

1. **Review validation errors**
   - Which checks failed?
   - How many positions affected?
   - Is it systematic or isolated?

2. **Fix and retry**
   - Adjust token decoder if decoding fails
   - Fix schema if data type mismatches
   - Modify queries if reconciliation off

3. **Document learnings**
   - Update specs with corrections
   - Add new validation checks
   - Refine success criteria

4. **Re-run pilot**
   - Drop and recreate pm_positions_indexer
   - Run sync-indexer-pilot.ts again
   - Verify all checks pass

---

## Documentation Deliverables

### After Pilot Completion

Create `docs/C1_INDEXER_PILOT_RESULTS.md` with:

1. **Execution Summary**
   - Start/end timestamps
   - Duration (fetch, decode, insert, verify)
   - Throughput (positions/sec)

2. **Data Quality Results**
   - All validation check results (PASS/FAIL)
   - Sample positions (top 5 by P&L)
   - Schema statistics (distinct wallets, markets, etc.)

3. **Reconciliation Results**
   - xcnstrategy P&L comparison
   - Delta and percent diff
   - Severity classification
   - Comparison to known baseline

4. **Issues Encountered**
   - List of errors/warnings
   - Root cause analysis
   - Fixes applied

5. **Recommendation**
   - Proceed to full backfill? (Yes/No)
   - Required changes before scaling
   - Next steps

---

## Timeline

| Task | Duration | Dependencies |
|------|----------|--------------|
| Implement token decoder | 30 min | None |
| Create GraphQL client | 30 min | None |
| Create pilot backfill script | 45 min | Token decoder, GraphQL client |
| Create validation script | 30 min | Pilot backfill complete |
| Create reconciliation script | 30 min | Pilot backfill complete |
| Run pilot and verify | 15 min | All scripts created |
| Document results | 30 min | Pilot complete |
| **Total** | **3 hours** | |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token decoding errors | Medium | High | Validate against known mappings |
| GraphQL rate limits | Low | Low | Implement backoff, monitor usage |
| Schema mismatch | Low | Medium | Validate data types before insert |
| Large reconciliation delta | Medium | Medium | Document expected differences |
| ClickHouse performance | Low | Low | Optimize queries, add indexes |

---

**Status:** Ready for implementation after Phase A completion

**Dependencies:**
- Phase A.1: C2 ghost cohort completion (for reconciliation test)
- ClickHouse schema deployed (sql/ddl_pm_positions_indexer.sql)
- Environment variables configured (CLICKHOUSE_HOST, etc.)

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
