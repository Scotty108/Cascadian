# AMM Coverage - Quick Reference Card

**Date:** 2025-11-15  
**Purpose:** One-page cheat sheet for tomorrow's implementation

---

## Key Findings (Don't Forget!)

### ❌ Activity Subgraph is NOT Trade Data
- It only has: splits, merges, redemptions, conditions
- It does NOT have: volume, trade counts, prices
- **Never use for trade data**

### ✅ ERC1155 Contains ALL Trades
- CLOB + AMM both create ERC1155 transfers
- 61.4M transfers in our database already
- 100% coverage of trading activity

### ✅ Token Mapping Works
- Table: `ctf_token_map`
- Column: `condition_id_norm` (64-char, NO 0x)
- Coverage: 92.82% (139,140 markets)

---

## Critical Schema Details

```typescript
// ctf_token_map (CORRECT FORMAT)
{
  token_id: string;          
  condition_id_norm: string;  // ← NO 0x prefix!
  outcome: string;
  question: string;
}

// erc1155_transfers
{
  token_id: string;          // ← Links to ctf_token_map
  from_address: string;
  to_address: string;
  value: string;
  block_timestamp: DateTime;
  tx_hash: string;
}

// clob_fills  
{
  condition_id: string;      // ← HAS 0x prefix
  maker: string;
  taker: string;
  price: string;
}
```

---

## ID Normalization (CRITICAL!)

```typescript
// Input: '0x54625984...' (66 chars with 0x)
// Normalized: '54625984...' (64 chars, lowercase, no 0x)

function normalize(id: string): string {
  return id.toLowerCase().replace('0x', '');
}

// Query patterns:
// clob_fills:      WHERE lower(replaceAll(condition_id, '0x', '')) = '${norm}'
// ctf_token_map:   WHERE condition_id_norm = '${norm}'
// gamma_markets:   WHERE lower(replaceAll(condition_id, '0x', '')) = '${norm}'
```

---

## ERC1155 Query Template

```sql
-- Step 1: Get token IDs
SELECT token_id, outcome
FROM ctf_token_map
WHERE condition_id_norm = '54625984...'  -- ← NO 0x

-- Step 2: Get transfers
SELECT 
  block_timestamp,
  from_address,
  to_address,
  value,
  tx_hash
FROM erc1155_transfers
WHERE token_id IN ('123...', '456...')
  AND from_address != '0x0000000000000000000000000000000000000000'
  AND to_address != '0x0000000000000000000000000000000000000000'
ORDER BY block_timestamp DESC
```

---

## System Addresses to Exclude

```typescript
const EXCLUDE = {
  ZERO: '0x0000000000000000000000000000000000000000',
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  // Add more as discovered
};
```

---

## Coverage Math

| Metric | Value |
|--------|-------|
| **Total markets** | 149,908 |
| **CLOB coverage** | 118,660 (79.16%) |
| **Token mappings** | 139,140 (92.82%) |
| **Missing from CLOB** | 31,248 (20.84%) |
| **Target coverage** | 92-100% |

---

## Implementation Order

1. ✅ **Read this + action plan**
2. Create `erc1155-trades.ts` (3-4 hours)
3. Create `hybrid-data-service.ts` (2-3 hours)  
4. Update API endpoints (1 hour)
5. Test & validate (2-3 hours)
6. Add caching (1-2 hours)

**Total:** 8-12 hours

---

## Test Market IDs

```typescript
// Zero-trade market (should return empty)
const NO_TRADES = '0x54625984ec20476ea88ceeaa93c1e38f3bccdd038adf391744a9a0bc1222ff9e';

// Find AMM-only market (query):
SELECT condition_id FROM gamma_markets
WHERE condition_id NOT IN (SELECT DISTINCT condition_id FROM clob_fills)
  AND condition_id IN (
    SELECT '0x' || condition_id_norm FROM ctf_token_map
    WHERE token_id IN (SELECT DISTINCT token_id FROM erc1155_transfers)
  )
LIMIT 1;
```

---

## Validation Query

```sql
-- Check final coverage
WITH coverage AS (
  SELECT
    condition_id,
    EXISTS(SELECT 1 FROM clob_fills c WHERE c.condition_id = g.condition_id) as has_clob,
    EXISTS(SELECT 1 FROM erc1155_transfers e WHERE e.token_id IN (
      SELECT token_id FROM ctf_token_map 
      WHERE condition_id_norm = lower(replace(g.condition_id, '0x', ''))
    )) as has_erc1155
  FROM gamma_markets g
)
SELECT
  round(100.0 * countIf(has_clob OR has_erc1155) / count(*), 2) as coverage_pct,
  countIf(has_clob) as clob_only,
  countIf(has_erc1155 AND NOT has_clob) as amm_only,
  countIf(NOT has_clob AND NOT has_erc1155) as no_data
FROM coverage;
```

**Expected:** 92-100% coverage

---

## Gotchas to Avoid

1. **Don't** query activity-subgraph for trades (it's not trade data!)
2. **Don't** forget ID normalization (different tables, different formats)
3. **Don't** skip filtering zero addresses (they're mints/burns, not trades)
4. **Do** implement caching (ERC1155 queries can be slow)
5. **Do** graceful fallback (try CLOB first, then ERC1155)

---

## Success Criteria

- [ ] Coverage > 90%
- [ ] All API endpoints use hybrid service
- [ ] Zero-trade markets return empty (not error)
- [ ] Performance < 500ms per market
- [ ] Code documented

---

**Remember:** CLOB is a subset of ERC1155, not the other way around!

**Good luck!** 🚀

---

**Claude 1** (2025-11-15)
