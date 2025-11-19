# Polymarket Wallet Identity & Attribution Design

**Date:** 2025-11-16
**Status:** DESIGN ONLY - Not Yet Implemented
**Purpose:** Define a robust wallet clustering system for Polymarket proxy/safe wallets

---

## Executive Summary

Polymarket uses smart contract wallets (Safe/Gnosis Safe) with EOAs as signers. Our current system only tracks by EOA address, causing:
- **Attribution errors:** Proxy wallet trades not linked to EOA
- **Coverage gaps:** 83.7% of xcnstrategy volume missing
- **ERC20 blind spot:** Settlement flows routed through proxy addresses

This design proposes a `pm_wallet_identity` mapping system that:
1. Groups EOA + proxy + safe addresses into single "wallet cluster"
2. Enables querying by raw address OR cluster ID
3. Integrates seamlessly with existing pm_trades and P&L tables

---

## Background: How Polymarket Wallets Work

### Polymarket Wallet Architecture

Based on Polymarket examples repo and smart contract patterns:

```
User → EOA (Signing Wallet)
        ↓
    Safe Contract (Proxy Wallet)
        ↓
    Settlement Contracts
        ↓
    Trading on Polymarket
```

**Key Relationships:**

1. **EOA (Externally Owned Account)**
   - User's signing wallet (e.g., MetaMask)
   - Example: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
   - Signs transactions but may not directly execute trades

2. **Safe/Proxy Wallet**
   - Smart contract wallet controlled by EOA
   - Example: `0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723`
   - Executes trades, holds positions, settles
   - Multiple EOAs can control same Safe

3. **Trading Patterns:**
   - CLOB trades may be attributed to EOA OR proxy
   - ERC1155 position transfers use proxy address
   - ERC20 settlement flows route through proxy
   - Polymarket API may show either address

### Analytics Implications

**Current Problem:**
- Our system stores trades by `wallet_address` (string)
- xcnstrategy has trades under EOA: `0xcc...58b`
- But some trades/settlements use proxy: `0xd5...723`
- Result: Data split across 2 addresses, incomplete P&L

**Required Solution:**
- Group related addresses into single "wallet cluster"
- Query P&L by cluster ID, not individual address
- Attribute all activity to primary identity (EOA)

---

## Design Proposal: Wallet Identity Model

### Schema Design

#### Table 1: pm_wallet_identity_map

**Purpose:** Maps individual addresses to wallet clusters

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_identity_map (
    -- Primary key
    address              String,           -- Lowercase address (EOA, proxy, safe, etc.)

    -- Cluster mapping
    cluster_id           String,           -- Canonical cluster identifier (usually primary EOA)
    address_type         Enum8(            -- Type of address
                           'eoa' = 1,
                           'safe_proxy' = 2,
                           'gnosis_safe' = 3,
                           'unknown' = 4
                         ),
    is_primary           UInt8,            -- 1 if this is the primary display address

    -- Metadata
    discovered_via       Enum8(            -- How relationship was discovered
                           'api' = 1,       -- Polymarket API metadata
                           'onchain' = 2,   -- On-chain Safe events
                           'manual' = 3,    -- Manually mapped
                           'heuristic' = 4  -- Pattern matching
                         ),
    confidence_score     Decimal(3,2),     -- 0.00 to 1.00 (mapping confidence)

    -- Timestamps
    first_seen           DateTime,         -- When relationship first discovered
    last_verified        DateTime,         -- Last time verified
    verified_by          String,           -- Source/process that verified

    -- Versioning (for ReplacingMergeTree)
    version              DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(version)
ORDER BY (address, cluster_id)
PARTITION BY substring(address, 1, 4);  -- Partition by first 4 hex chars
```

**Index Strategy:**
- **Primary:** ORDER BY (address, cluster_id) - Fast lookup by address
- **Partition:** By address prefix - Balanced partition sizes

#### Table 2: pm_wallet_cluster_metadata

**Purpose:** Stores metadata about wallet clusters

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_cluster_metadata (
    -- Primary key
    cluster_id           String,           -- Cluster identifier

    -- Identity
    display_name         String,           -- Human-readable name (e.g., "xcnstrategy")
    primary_address      String,           -- Primary address for display (usually EOA)

    -- Cluster composition
    address_count        UInt16,           -- Number of addresses in cluster
    has_safe_wallet      UInt8,            -- 1 if cluster includes Safe wallet
    has_proxy            UInt8,            -- 1 if cluster includes proxy

    -- Discovery metadata
    created_at           DateTime,         -- When cluster first created
    updated_at           DateTime,         -- Last modification
    data_quality_score   Decimal(3,2),     -- Overall cluster quality (0-1)

    -- Versioning
    version              DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(version)
ORDER BY cluster_id;
```

### Example Data

**pm_wallet_identity_map:**

| address | cluster_id | address_type | is_primary | discovered_via | confidence |
|---------|-----------|--------------|------------|----------------|------------|
| 0xcce2b7...58b | 0xcce2b7...58b | eoa | 1 | manual | 1.00 |
| 0xd59d03...723 | 0xcce2b7...58b | safe_proxy | 0 | onchain | 0.95 |

**pm_wallet_cluster_metadata:**

| cluster_id | display_name | primary_address | address_count | has_safe_wallet |
|-----------|-------------|-----------------|---------------|-----------------|
| 0xcce2b7...58b | xcnstrategy | 0xcce2b7...58b | 2 | 1 |

---

## ETL & Population Strategy

### Phase 1: Bootstrap from Known Mappings

**Manual Seed Data:**

```sql
-- Insert known wallet clusters (like xcnstrategy)
INSERT INTO pm_wallet_identity_map VALUES
  ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', 'eoa', 1, 'manual', 1.00, now(), now(), 'bootstrap', now()),
  ('0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723', '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', 'safe_proxy', 0, 'manual', 1.00, now(), now(), 'bootstrap', now());

INSERT INTO pm_wallet_cluster_metadata VALUES
  ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', 'xcnstrategy', '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', 2, 1, 1.00, now(), now(), 1.00, now());
```

### Phase 2: Discover from On-Chain Events

**Safe Wallet Creation Events:**

```sql
-- Pseudocode: Discover Safe wallets from deployment events
INSERT INTO pm_wallet_identity_map
SELECT
  safe_address AS address,
  owner_address AS cluster_id,
  'gnosis_safe' AS address_type,
  0 AS is_primary,
  'onchain' AS discovered_via,
  0.90 AS confidence_score,
  block_time AS first_seen,
  now() AS last_verified,
  'safe_deployment_events' AS verified_by,
  now() AS version
FROM safe_deployment_events
WHERE owner_count = 1  -- Single-owner safes only (high confidence)
```

### Phase 3: Heuristic Discovery

**Transaction Pattern Matching:**

```sql
-- Pseudocode: Find wallets that frequently transact together
WITH frequent_pairs AS (
  SELECT
    from_address,
    to_address,
    COUNT(*) AS tx_count
  FROM erc20_transfers
  WHERE from_address != to_address
  GROUP BY from_address, to_address
  HAVING tx_count > 10  -- Threshold for "frequent"
)
SELECT
  to_address AS address,
  from_address AS cluster_id,
  'unknown' AS address_type,
  0 AS is_primary,
  'heuristic' AS discovered_via,
  LEAST(0.70, tx_count / 100.0) AS confidence_score,
  ...
FROM frequent_pairs
WHERE confidence_score > 0.50;
```

### Phase 4: Polymarket API Integration

**API Endpoint (hypothetical):**

```typescript
// Pseudocode: Query Polymarket API for wallet metadata
async function discoverWalletRelationships(address: string) {
  const response = await fetch(`https://api.polymarket.com/wallet/${address}/metadata`);
  const data = await response.json();

  if (data.proxy_address) {
    // Insert mapping
    await clickhouse.insert('pm_wallet_identity_map', {
      address: data.proxy_address.toLowerCase(),
      cluster_id: address.toLowerCase(),
      address_type: 'safe_proxy',
      is_primary: 0,
      discovered_via: 'api',
      confidence_score: 1.00,
      ...
    });
  }
}
```

---

## Integration with Existing Tables

### View 1: vw_wallet_canonical_address

**Purpose:** Helper view to resolve any address to its cluster ID

```sql
CREATE VIEW vw_wallet_canonical_address AS
SELECT
  address,
  cluster_id,
  address_type,
  is_primary
FROM pm_wallet_identity_map
WHERE version IN (
  SELECT MAX(version)
  FROM pm_wallet_identity_map AS inner_map
  WHERE inner_map.address = pm_wallet_identity_map.address
);
```

**Usage:**

```sql
-- Resolve xcnstrategy proxy to EOA
SELECT cluster_id
FROM vw_wallet_canonical_address
WHERE address = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';
-- Returns: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
```

### View 2: vw_wallet_pnl_v2_clustered

**Purpose:** P&L aggregated by wallet cluster (not individual address)

```sql
CREATE VIEW vw_wallet_pnl_v2_clustered AS
SELECT
  COALESCE(w.cluster_id, p.wallet_address) AS cluster_id,
  SUM(p.total_pnl_usd) AS total_pnl_usd,
  SUM(p.realized_pnl_usd) AS realized_pnl_usd,
  SUM(p.unrealized_pnl_usd) AS unrealized_pnl_usd,
  SUM(p.settlement_pnl_usd) AS settlement_pnl_usd,
  SUM(p.total_trades) AS total_trades,
  SUM(p.covered_volume_usd) AS total_volume_usd,
  COUNT(DISTINCT p.condition_id_norm) AS total_markets
FROM pm_wallet_market_pnl_v2 AS p
LEFT JOIN vw_wallet_canonical_address AS w
  ON lower(p.wallet_address) = w.address
GROUP BY cluster_id;
```

**Before Clustering (current):**

| wallet_address | total_pnl_usd |
|----------------|---------------|
| 0xcce2b7...58b | -$206,256.59 |
| 0xd59d03...723 | $0 (no data) |

**After Clustering (proposed):**

| cluster_id | total_pnl_usd |
|------------|---------------|
| 0xcce2b7...58b | -$206,256.59 + [proxy trades] |

### View 3: vw_wallet_all_addresses

**Purpose:** Expand cluster ID to all related addresses

```sql
CREATE VIEW vw_wallet_all_addresses AS
SELECT
  cluster_id,
  groupArray(address) AS all_addresses,
  argMax(address, is_primary) AS primary_address,
  SUM(is_primary) AS primary_count
FROM pm_wallet_identity_map
GROUP BY cluster_id;
```

**Usage:**

```sql
-- Get all addresses for xcnstrategy cluster
SELECT all_addresses
FROM vw_wallet_all_addresses
WHERE cluster_id = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
-- Returns: ['0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723']
```

---

## Integration with pm_trades_canonical_v2

### Option A: Enrich at Query Time (Recommended)

**Pros:** No schema changes, backward compatible
**Cons:** Slightly slower queries

```sql
-- Example: Get trades for xcnstrategy cluster
SELECT
  t.*,
  COALESCE(w.cluster_id, t.wallet_address) AS canonical_wallet_id
FROM pm_trades_canonical_v2 AS t
LEFT JOIN vw_wallet_canonical_address AS w
  ON lower(t.wallet_address) = w.address
WHERE canonical_wallet_id = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

### Option B: Add Materialized Column (Future)

**Pros:** Faster queries
**Cons:** Requires schema migration

```sql
-- Add column to pm_trades_canonical_v2
ALTER TABLE pm_trades_canonical_v2
ADD COLUMN wallet_cluster_id String DEFAULT wallet_address;

-- Backfill
ALTER TABLE pm_trades_canonical_v2
UPDATE wallet_cluster_id = (
  SELECT cluster_id
  FROM vw_wallet_canonical_address
  WHERE address = lower(wallet_address)
)
WHERE wallet_cluster_id = wallet_address;
```

---

## Data Quality & Confidence Scoring

### Confidence Score Calculation

```typescript
function calculateConfidenceScore(discovery_method: string, supporting_evidence: number): number {
  const base_scores = {
    manual: 1.00,        // Human-verified
    api: 0.95,           // Polymarket API confirmed
    onchain: 0.90,       // On-chain events (Safe creation)
    heuristic: 0.70      // Pattern matching
  };

  let score = base_scores[discovery_method];

  // Adjust based on supporting evidence
  if (supporting_evidence > 100) score = Math.min(1.00, score + 0.05);
  if (supporting_evidence > 1000) score = Math.min(1.00, score + 0.05);

  return score;
}
```

### Validation Rules

**Required for High Confidence (>0.90):**
1. On-chain evidence (Safe deployment event) OR
2. Polymarket API confirmation OR
3. Manual verification by analyst

**Acceptable for Medium Confidence (0.70-0.90):**
1. Heuristic pattern matching with >50 transactions
2. Multiple independent discovery methods agree

**Flag for Review (<0.70):**
1. Single heuristic source only
2. Conflicting evidence from multiple sources

---

## Migration & Rollout Plan

### Phase 1: Bootstrap (Week 1)
- Create pm_wallet_identity_map and pm_wallet_cluster_metadata tables
- Insert manual seed data for known wallets (xcnstrategy, etc.)
- Create vw_wallet_canonical_address view
- Test cluster resolution queries

### Phase 2: On-Chain Discovery (Week 2)
- Query Safe deployment events from blockchain
- Populate single-owner Safe relationships
- Run validation queries, review confidence scores

### Phase 3: View Integration (Week 3)
- Create vw_wallet_pnl_v2_clustered view
- Update API endpoints to use clustered views
- A/B test: old address-based vs new cluster-based results

### Phase 4: Heuristic Discovery (Week 4)
- Implement transaction pattern matching
- Discover additional proxy relationships
- Manual review of medium-confidence mappings

### Phase 5: Production Rollout (Week 5)
- Enable cluster-based queries in UI
- Add "Show all addresses" toggle to wallet detail pages
- Monitor query performance, optimize indexes

---

## API Integration Examples

### REST API Updates

**Before (address-based):**
```
GET /api/wallets/0xcce2b7c71f21e358b8e5e797e586cbc03160d58b/pnl
Returns: { pnl: -206256.59, volume: 225572.34 }
```

**After (cluster-based):**
```
GET /api/wallets/0xcce2b7c71f21e358b8e5e797e586cbc03160d58b/pnl?cluster=true
Returns: {
  pnl: -206256.59,
  volume: 1383851.59,  # Includes proxy trades
  addresses: [
    { address: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", type: "eoa", primary: true },
    { address: "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723", type: "safe_proxy", primary: false }
  ]
}
```

### Query Helper Functions

```typescript
// lib/clickhouse/wallet-identity.ts
export async function resolveWalletCluster(address: string): Promise<string> {
  const result = await clickhouse.query({
    query: `
      SELECT cluster_id
      FROM vw_wallet_canonical_address
      WHERE address = {address:String}
    `,
    query_params: { address: address.toLowerCase() }
  });

  return result[0]?.cluster_id || address;  // Fallback to input if no mapping
}

export async function getClusterAddresses(clusterId: string): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT all_addresses
      FROM vw_wallet_all_addresses
      WHERE cluster_id = {clusterId:String}
    `,
    query_params: { clusterId: clusterId.toLowerCase() }
  });

  return result[0]?.all_addresses || [clusterId];
}
```

---

## Testing & Validation

### Test Cases

**Test 1: Known Cluster Resolution**
```sql
-- Verify xcnstrategy proxy resolves to EOA
SELECT cluster_id
FROM vw_wallet_canonical_address
WHERE address = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';
-- Expected: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
```

**Test 2: Cluster P&L Aggregation**
```sql
-- Verify clustered P&L includes all addresses
SELECT
  cluster_id,
  total_trades,
  total_volume_usd
FROM vw_wallet_pnl_v2_clustered
WHERE cluster_id = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
-- Expected: trades from both EOA and proxy
```

**Test 3: Unmapped Address Fallback**
```sql
-- Verify unmapped addresses return themselves as cluster_id
SELECT COALESCE(cluster_id, '0x1234...') AS result
FROM vw_wallet_canonical_address
WHERE address = '0x1234...';
-- Expected: 0x1234... (fallback works)
```

---

## Performance Considerations

### Index Optimization

**pm_wallet_identity_map:**
- ORDER BY (address, cluster_id) - Fast address→cluster lookups
- Partition by address prefix - Balanced partitions (~10K addresses each)

**Query Performance Estimates:**
- Address→cluster lookup: <5ms (indexed)
- Cluster→addresses lookup: <10ms (small groupArray)
- Clustered P&L aggregation: <50ms (existing pm_wallet_market_pnl_v2 speed)

### Caching Strategy

**Application-Level Cache:**
```typescript
// Cache cluster mappings for 1 hour
const clusterCache = new Map<string, string>();

async function getCachedCluster(address: string): Promise<string> {
  if (clusterCache.has(address)) {
    return clusterCache.get(address)!;
  }

  const clusterId = await resolveWalletCluster(address);
  clusterCache.set(address, clusterId);

  return clusterId;
}
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Incorrect mapping** | High (wrong P&L attribution) | Confidence scoring + manual review |
| **Performance degradation** | Medium (slower queries) | Indexed lookups + caching |
| **Breaking changes** | Low (backward compatible) | Views-based approach, existing queries work |
| **Data quality issues** | Medium (low-confidence mappings) | Validation rules + alert thresholds |

---

## Future Enhancements

### Multi-Signature Safes
- Support Safes with multiple owners
- Create many-to-many cluster relationships
- Add owner_role (primary, secondary, etc.)

### Cross-Chain Wallets
- Map addresses across multiple chains
- Track wallet activity on Polygon + Ethereum

### Machine Learning Discovery
- Train ML model on transaction patterns
- Auto-discover proxy relationships with high confidence
- Flag anomalous wallet behaviors

---

## Conclusion

This design provides a robust, scalable foundation for wallet clustering that:
- ✅ Groups EOA + proxy + safe addresses into single cluster
- ✅ Maintains backward compatibility (no breaking changes)
- ✅ Supports incremental discovery (manual → on-chain → heuristic → ML)
- ✅ Integrates seamlessly with existing P&L tables
- ✅ Enables accurate P&L attribution for smart contract wallets

**Next Steps:**
1. Review and approve design
2. Create DDL scripts for tables + views
3. Bootstrap with known wallet mappings (xcnstrategy, etc.)
4. Test cluster resolution and P&L aggregation
5. Integrate with API endpoints

**Do NOT implement** until design is approved.

---

**Design Complete**
**Date:** 2025-11-16
**Terminal:** Claude 1
**Status:** READY FOR REVIEW
