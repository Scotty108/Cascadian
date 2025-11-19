# Polymarket Payout Vectors - Quick Reference

## One-Line Summary

Use the PNL Subgraph at Goldsky to get payout vectors for any condition_id.

---

## The API

```
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn
```

---

## Quick Examples

### Get Single Payout Vector

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ condition(id: \"0x73ac4c1e5be0a89685328c9f5b833d828ffd62dfa07ceaf8536edbc43aa5f51e\") { payoutNumerators payoutDenominator } }"
  }'
```

### Get Multiple Payout Vectors

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ conditions(where: {id_in: [\"0x73ac...\", \"0x08f5...\"]}) { id payoutNumerators payoutDenominator } }"
  }'
```

### Get All Resolved Conditions

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ conditions(first: 1000, where: {payoutDenominator_gt: \"0\"}) { id payoutNumerators payoutDenominator } }"
  }'
```

---

## P&L Formula

```
pnl = shares * (payoutNumerators[outcomeIndex] / payoutDenominator) - (shares * avgPrice)
```

### Example

```javascript
// Position data
shares = 1000
avgPrice = 0.50
outcomeIndex = 1  // user bet on outcome 1

// Payout vector
payoutNumerators = [0, 1]  // outcome 0 loses, outcome 1 wins
payoutDenominator = 1

// Calculate
costBasis = 1000 * 0.50 = $500
settlementValue = 1000 * (1 / 1) = $1000
pnl = $1000 - $500 = +$500
```

---

## ClickHouse Schema

```sql
CREATE TABLE payout_vectors (
    condition_id String,
    payout_numerators Array(UInt64),
    payout_denominator UInt64,
    position_ids Array(String),
    resolved_at DateTime DEFAULT now(),
    _version UInt64 DEFAULT 1
) ENGINE = ReplacingMergeTree(_version)
ORDER BY condition_id;
```

---

## P&L Query

```sql
SELECT
    wallet_id,
    condition_id,
    SUM(shares) as shares,
    AVG(price) as avg_price,
    SUM(shares * price) as cost_basis,
    payout_numerators[outcome_index + 1] as numerator,  -- ClickHouse is 1-indexed
    payout_denominator as denominator,
    (shares * (numerator / denominator)) - cost_basis as pnl
FROM trades
LEFT JOIN payout_vectors USING (condition_id)
WHERE payout_denominator > 0
GROUP BY wallet_id, condition_id, outcome_index, payout_numerators, payout_denominator;
```

---

## Backfill Command

```bash
npm run backfill-payouts from-trades
```

---

## Key Gotchas

1. **Array Indexing**
   - GraphQL: 0-indexed
   - ClickHouse: 1-indexed
   - Use `outcome_index + 1` in ClickHouse

2. **Condition ID Format**
   - Lowercase, no '0x' prefix
   - 64 hex characters (32 bytes)

3. **Unresolved Markets**
   - `payoutDenominator = 0` means not resolved
   - Filter with `WHERE payoutDenominator > 0`

4. **Batch Limits**
   - Max 1000 conditions per query
   - Use pagination for more

---

## Common Patterns

### Check Resolution Status

```graphql
{
  condition(id: "0x73ac...") {
    payoutDenominator
  }
}
```

If `payoutDenominator > 0`, market is resolved.

### Get User's Resolved Positions

```sql
SELECT
    t.condition_id,
    m.title,
    SUM(t.shares) as shares,
    p.payout_numerators[t.outcome_index + 1] as won,
    (shares * won) - SUM(t.shares * t.price) as pnl
FROM trades t
JOIN payout_vectors p ON p.condition_id = t.condition_id
JOIN markets m ON m.condition_id = t.condition_id
WHERE t.wallet_id = '0x...'
    AND p.payout_denominator > 0
GROUP BY t.condition_id, t.outcome_index, m.title, p.payout_numerators, p.payout_denominator
ORDER BY pnl DESC;
```

### Find Missing Payout Vectors

```sql
SELECT DISTINCT condition_id
FROM trades
WHERE condition_id NOT IN (
    SELECT condition_id FROM payout_vectors WHERE payout_denominator > 0
);
```

---

## Testing

### Verify Accuracy

```bash
# Get Polymarket's P&L
POLYMARKET_PNL=$(curl -s "https://data-api.polymarket.com/positions?user=0x4ce73141dbfce41e65db3723e31059a730f0abad" | jq '.[0].cashPnl')

# Calculate our P&L
OUR_PNL=$(clickhouse-client --query "SELECT realized_pnl FROM vw_wallet_realized_pnl WHERE wallet_id = '0x4ce73141dbfce41e65db3723e31059a730f0abad' LIMIT 1")

# Compare
echo "Polymarket: $POLYMARKET_PNL"
echo "Our calc:   $OUR_PNL"
```

---

## Resources

- **Full Docs:** `POLYMARKET_UNDOCUMENTED_APIS_DISCOVERED.md`
- **Implementation:** `QUICK_START_PAYOUT_VECTORS.md`
- **Backfill Script:** `scripts/backfill-payout-vectors.ts`
- **SQL Views:** `lib/clickhouse/queries/wallet-pnl-with-payouts.sql`

---

## Status

- [x] API discovered
- [x] Formula validated
- [x] Code written
- [ ] Backfill run
- [ ] Production tested

---

**Last Updated:** 2025-11-09
