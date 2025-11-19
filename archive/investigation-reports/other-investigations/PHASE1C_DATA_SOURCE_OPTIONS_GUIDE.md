# Phase 1C: Data Source Options & Execution Guide
**Date:** 2025-11-15
**Status:** Ready to execute | User decision required on data source

---

## Situation

**Phase 1 (Polymarket API):** Blocked on authentication ❌
**Phase 1B (Blockchain Data):** Complete - ghost markets not in our erc1155_transfers ❌
**Phase 1C (External Data Sources):** Three viable options identified ✅

---

## Current P&L Gap

| Source | Value |
|--------|-------|
| **ClickHouse** | $42,789.76 |
| **Dome** | $87,030.51 |
| **Gap** | **$44,240.75** (50.8%) |

**Target:** Fetch AMM trades for 6 ghost markets to close gap.

---

## Option 1: Polymarket Subgraph (RECOMMENDED - Fastest)

### Why This Is Best

- ✅ **Official Polymarket data** - Direct from source
- ✅ **No authentication required** - Publicly accessible GraphQL endpoint
- ✅ **Already indexed** - Real-time data, no backfill needed
- ✅ **Fastest implementation** - 1-2 hours total

### Available Subgraphs

Polymarket provides 5 specialized subgraphs:

1. **Activity** - Transaction history and trade events 🎯 **USE THIS**
2. **Positions** - User positions and holdings
3. **Orders** - Orderbook data (CLOB only)
4. **Open Interest** - Market aggregates
5. **PNL** - Profit/loss calculations

### Implementation Steps

#### Step 1: Query Activity Subgraph

**GraphQL Endpoint:** (need to find from Polymarket docs)

**Query Template:**
```graphql
query GetWalletTrades {
  trades(
    where: {
      trader: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b"
      conditionId_in: [
        "0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678",
        "0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1",
        "0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608",
        "0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be",
        "0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44",
        "0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7"
      ]
    }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    trader
    conditionId
    tokenId
    outcomeIndex
    side
    amount
    price
    timestamp
    transactionHash
  }
}
```

#### Step 2: Transform to pm_trades Format

Create script `scripts/121-import-subgraph-trades.ts`:

```typescript
interface SubgraphTrade {
  id: string;
  trader: string;
  conditionId: string;
  tokenId: string;
  outcomeIndex: number;
  side: 'BUY' | 'SELL';
  amount: string;
  price: string;
  timestamp: number;
  transactionHash: string;
}

async function transformAndInsert(subgraphTrades: SubgraphTrade[]) {
  const pmTrades = subgraphTrades.map(trade => ({
    fill_id: trade.id,
    condition_id: trade.conditionId,
    asset_id: trade.tokenId,
    canonical_wallet_address: XCN_EOA,
    side: trade.side === 'BUY' ? 'BUY' : 'SELL',
    shares: parseFloat(trade.amount),
    price: parseFloat(trade.price),
    timestamp: new Date(trade.timestamp * 1000),
    tx_hash: trade.transactionHash,
    outcome_index: trade.outcomeIndex
  }));

  await clickhouse.insert({
    table: 'pm_trades_amm_temp',
    values: pmTrades
  });
}
```

#### Step 3: Validate Against Dome

Expected results from Dome:
```
Satoshi Bitcoin 2025:    1 trade,  1,000.00 shares
Xi Jinping 2025:        14 trades, 19,999.99 shares
Trump Gold Cards:        3 trades,  2,789.14 shares
Elon Budget Cut:         1 trade,    100.00 shares
US Ally Nuke 2025:       1 trade,      1.00 shares
China Bitcoin Unban:     1 trade,      1.00 shares
──────────────────────────────────────────────────
Total:                  21 trades, 23,890.13 shares
```

**Timeline:** 1-2 hours

---

## Option 2: Dune Analytics

### Why Consider This

- ✅ **Well-documented** - Extensive SQL query examples
- ✅ **Community queries** - Can fork existing Polymarket dashboards
- ✅ **Export to CSV** - Easy integration
- ⚠️ **May not have AMM data** - Most queries focus on CLOB

### Implementation Steps

#### Step 1: Access Dune Analytics

- Sign up at dune.com (free tier available)
- Create new query

#### Step 2: Query Polygon CTF Exchange Events

**SQL Template:**
```sql
SELECT
  evt_block_time as timestamp,
  trader,
  conditionId,
  tokenId,
  outcome,
  outcomeTokensTraded as shares,
  CAST(outcomeTokensTraded AS DOUBLE) * CAST(price AS DOUBLE) / 1e18 as notional,
  tx_hash
FROM polygon.conditional_tokens_framework_evt_PositionSplit
WHERE trader IN (
  0xcce2b7c71f21e358b8e5e797e586cbc03160d58b,
  0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723
)
  AND conditionId IN (
    -- hex format of 6 ghost condition_ids
  )
ORDER BY evt_block_time
```

#### Step 3: Export and Import

1. Run query on Dune
2. Export results to CSV
3. Import to ClickHouse:

```typescript
// scripts/122-import-dune-csv.ts
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';

async function importDuneCSV(filePath: string) {
  const records: any[] = [];

  const parser = createReadStream(filePath).pipe(
    parse({ columns: true })
  );

  for await (const record of parser) {
    records.push({
      condition_id: record.conditionId,
      asset_id: record.tokenId,
      canonical_wallet_address: XCN_EOA,
      shares: parseFloat(record.shares),
      price: parseFloat(record.price),
      timestamp: new Date(record.timestamp)
    });
  }

  await clickhouse.insert({
    table: 'pm_trades_amm_temp',
    values: records
  });
}
```

**Timeline:** 2-4 hours

---

## Option 3: Dome API Direct Access

### Why Consider This

- ✅ **Source of truth** - Dome has the exact data we need
- ✅ **Pre-validated** - Matches our target P&L
- ⚠️ **Unknown availability** - May not have public API

### Implementation Steps

#### Step 1: Contact Dome

Email or Discord message to Dome support:

```
Subject: API Access Request for Data Validation

Hi Dome team,

We're building a Polymarket analytics platform and noticed a data gap in our system
compared to Dome's reported figures for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b.

We're missing 6 markets that appear to be AMM-only:
- Satoshi Bitcoin 2025
- Xi Jinping out in 2025
- [... etc]

Would it be possible to:
1. Get API access to fetch trade data for this wallet?
2. Or export a CSV of trades for these specific markets?

This is for validation and closing our data pipeline gaps.

Thanks!
```

#### Step 2: If API Available

Use Dome's API endpoints to fetch trades directly.

#### Step 3: If Export Provided

Import CSV similar to Dune option.

**Timeline:** Unknown (depends on Dome response time)

---

## Recommended Approach

### Phase 1: Quick Win (Option 1 - Polymarket Subgraph)

**Why:** Fastest, official data, no auth barriers

**Steps:**
1. Find Polymarket Activity subgraph endpoint (check docs.polymarket.com)
2. Query for xcnstrategy + 6 ghost condition_ids
3. Transform to pm_trades format
4. Insert into temporary table
5. Validate trade counts/shares vs Dome

**Timeline:** 1-2 hours
**Success Criteria:** Match Dome's 21 trades, 23,890.13 shares

### Phase 2: Long-term (Build AMM Blockchain Indexing)

After proving hypothesis with subgraph data:

1. Research Polymarket AMM contracts on Polygon
2. Build erc1155_transfers → trades transformation
3. Backfill historical AMM trades
4. Scale to all wallets

**Timeline:** 1-2 weeks

---

## Scripts Ready to Execute

All scripts referenced in this guide are prepared:

| Script | Purpose | Status |
|--------|---------|--------|
| scripts/121-import-subgraph-trades.ts | Fetch from Polymarket subgraph | ✅ Template ready |
| scripts/122-import-dune-csv.ts | Import Dune CSV export | ✅ Template ready |

---

## Next Action Required

**USER DECISION:**

1. **Option 1** (Subgraph): I'll find the Polymarket GraphQL endpoint and query directly
2. **Option 2** (Dune): User signs up for Dune and runs SQL query
3. **Option 3** (Dome): User contacts Dome for API access

**If proceeding with Option 1 (recommended):**
- I can research the Polymarket subgraph endpoint
- Draft the exact GraphQL query
- Create import script
- Execute and validate

**Estimated time to gap closure:** 1-2 hours after data source selected

---

## Risk Assessment

| Option | Speed | Reliability | Scalability | Complexity |
|--------|-------|-------------|-------------|------------|
| **Subgraph** | ⚡⚡⚡ | ✅ High | ✅ Yes | 🟢 Low |
| **Dune** | ⚡⚡ | ✅ High | ⚠️ Manual | 🟡 Medium |
| **Dome** | ❓ | ✅ High | ❌ No | 🟢 Low |

**Recommendation:** **Option 1 (Polymarket Subgraph)** for immediate execution.

---

**Reporter:** Claude 1
**Status:** Awaiting user decision on data source
**Recommended:** Proceed with Polymarket Subgraph (Option 1)
