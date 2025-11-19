# Quick Start: Getting Payout Vectors from Polymarket

## TL;DR

Use the **PNL Subgraph** to get payout vectors for any condition_id:

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ condition(id: \"YOUR_CONDITION_ID_HERE\") { id payoutNumerators payoutDenominator positionIds } }"
  }'
```

---

## Step-by-Step Example

### 1. Get a Wallet's Positions

```bash
curl "https://data-api.polymarket.com/positions?user=0x4ce73141dbfce41e65db3723e31059a730f0abad&limit=5"
```

**Result:** You get positions with `conditionId` field

### 2. Query Payout Vector for Each Condition

```bash
# Example condition_id from step 1
CONDITION_ID="0x73ac4c1e5be0a89685328c9f5b833d828ffd62dfa07ceaf8536edbc43aa5f51e"

curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"{ condition(id: \\\"$CONDITION_ID\\\") { id payoutNumerators payoutDenominator positionIds } }\"
  }"
```

**Response:**
```json
{
  "data": {
    "condition": {
      "id": "0x73ac4c1e5be0a89685328c9f5b833d828ffd62dfa07ceaf8536edbc43aa5f51e",
      "payoutNumerators": ["0", "1"],
      "payoutDenominator": "1",
      "positionIds": ["48285207411891694847413807268670593735244327770017422161322089036370055854362", "61844668920737118615861173747694492670799904596778544814046771923624799983782"]
    }
  }
}
```

### 3. Calculate P&L

```javascript
// From position data
const shares = 29403263.356533;
const avgPrice = 0.030695;
const outcomeIndex = 0; // This user held "Yes" shares

// From payout vector
const payoutNumerators = [0, 1];
const payoutDenominator = 1;

// Calculate
const costBasis = shares * avgPrice; // 902,533.17
const settlementValue = shares * (payoutNumerators[outcomeIndex] / payoutDenominator); // 29403263.356533 * (0 / 1) = 0
const pnl = settlementValue - costBasis; // -902,533.17
```

---

## Batch Query Multiple Conditions

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ conditions(where: {id_in: [\"0x73ac4c1e5be0a89685328c9f5b833d828ffd62dfa07ceaf8536edbc43aa5f51e\", \"0x08f5fe8d0d29c08a96f0bc3dfb52f50e0caf470d94d133d95d38fa6c847e0925\"]}) { id payoutNumerators payoutDenominator } }"
  }'
```

---

## Get All Resolved Conditions

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ conditions(first: 1000, where: {payoutDenominator_gt: 0}) { id payoutNumerators payoutDenominator } }"
  }'
```

**Note:** Use pagination with `skip` for more than 1000 results:
```graphql
{
  conditions(first: 1000, skip: 1000, where: {payoutDenominator_gt: 0}) {
    id
    payoutNumerators
    payoutDenominator
  }
}
```

---

## Integration with CASCADIAN

### Add to ClickHouse Schema

```sql
CREATE TABLE polymarket.payout_vectors (
    condition_id String,
    payout_numerators Array(UInt64),
    payout_denominator UInt64,
    position_ids Array(String),
    resolved_at DateTime DEFAULT now(),
    _version UInt64 DEFAULT 1
) ENGINE = ReplacingMergeTree(_version)
ORDER BY condition_id;
```

### Backfill Script (TypeScript)

```typescript
import { createClient } from '@clickhouse/client';

const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn';

async function fetchPayoutVectors(conditionIds: string[]) {
  const query = `
    query GetPayouts($ids: [ID!]!) {
      conditions(where: {id_in: $ids}) {
        id
        payoutNumerators
        payoutDenominator
        positionIds
      }
    }
  `;

  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { ids: conditionIds }
    })
  });

  const data = await response.json();
  return data.data.conditions;
}

async function backfillPayoutVectors() {
  const client = createClient({
    host: 'http://localhost:8123',
    database: 'polymarket'
  });

  // Get unique condition IDs from trades
  const result = await client.query({
    query: 'SELECT DISTINCT condition_id FROM trades WHERE condition_id != \'\''
  });

  const conditionIds = await result.json();

  // Batch process (1000 at a time)
  const batchSize = 1000;
  for (let i = 0; i < conditionIds.data.length; i += batchSize) {
    const batch = conditionIds.data.slice(i, i + batchSize);
    const ids = batch.map(row => row.condition_id);

    console.log(`Fetching batch ${i / batchSize + 1}...`);
    const payouts = await fetchPayoutVectors(ids);

    // Insert into ClickHouse
    if (payouts.length > 0) {
      await client.insert({
        table: 'payout_vectors',
        values: payouts.map(p => ({
          condition_id: p.id,
          payout_numerators: p.payoutNumerators.map(Number),
          payout_denominator: Number(p.payoutDenominator),
          position_ids: p.positionIds
        })),
        format: 'JSONEachRow'
      });
    }

    console.log(`Inserted ${payouts.length} payout vectors`);
  }

  await client.close();
}

backfillPayoutVectors().catch(console.error);
```

### P&L Query with Payout Vectors

```sql
SELECT
    t.wallet_id,
    t.condition_id,
    t.outcome_index,
    SUM(t.shares) as total_shares,
    AVG(t.price) as avg_price,
    SUM(t.shares * t.price) as cost_basis,
    p.payout_numerators[t.outcome_index + 1] as payout_numerator,
    p.payout_denominator,
    (total_shares * (payout_numerator / payout_denominator)) - cost_basis as realized_pnl
FROM polymarket.trades t
LEFT JOIN polymarket.payout_vectors p ON p.condition_id = t.condition_id
WHERE p.payout_denominator > 0
GROUP BY t.wallet_id, t.condition_id, t.outcome_index, p.payout_numerators, p.payout_denominator
ORDER BY realized_pnl DESC;
```

---

## Alternative: Activity Subgraph for Redemptions

**Endpoint:** `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn`

```bash
curl -X POST https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ redemptions(first: 100, where: {user: \"0x4ce73141dbfce41e65db3723e31059a730f0abad\"}) { id user tokenIds amounts timestamp transactionHash } }"
  }'
```

---

## Real-time Updates via WebSocket

```javascript
const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/');

ws.on('message', (data) => {
  const message = JSON.parse(data);

  if (message.topic === 'clob_market.market_resolved') {
    const conditionId = message.data.condition_id;

    // Fetch payout vector immediately
    fetchPayoutVectors([conditionId]).then(payouts => {
      console.log('Market resolved:', payouts[0]);
      // Insert into ClickHouse
    });
  }
});

ws.send(JSON.stringify({
  type: 'subscribe',
  topic: 'clob_market.market_resolved'
}));
```

---

## Testing Validation

Compare your P&L calculation against Polymarket's Data API:

```bash
# Your calculation
MY_PNL=-902533.17

# Polymarket's calculation
POLYMARKET_PNL=$(curl -s "https://data-api.polymarket.com/positions?user=0x4ce73141dbfce41e65db3723e31059a730f0abad&market=0x73ac4c1e5be0a89685328c9f5b833d828ffd62dfa07ceaf8536edbc43aa5f51e" | jq '.[0].cashPnl')

echo "My P&L: $MY_PNL"
echo "Polymarket P&L: $POLYMARKET_PNL"
echo "Difference: $(echo "$MY_PNL - $POLYMARKET_PNL" | bc)"
```

---

## Key Gotchas

1. **Array Indexing**
   - GraphQL returns 0-indexed arrays
   - ClickHouse uses 1-indexed arrays
   - Use `arrayElement(payout_numerators, outcome_index + 1)`

2. **Condition ID Format**
   - Always lowercase
   - Strip '0x' prefix for storage
   - Expect 64 hex characters (32 bytes)

3. **Unresolved Markets**
   - `payoutDenominator = 0` means not resolved yet
   - Filter with `WHERE payoutDenominator > 0`

4. **Multi-outcome Markets**
   - Some markets have 3+ outcomes
   - `payoutNumerators.length === number of outcomes`
   - Sum of numerators may not equal denominator (partial payouts)

5. **Negative Risk Markets**
   - Special handling via `NegRiskEvent` entity
   - Multiple questions share same event
   - Check `negativeRisk` flag in Data API response

---

## Performance Tips

1. **Batch Queries**
   - Fetch 1000 conditions per GraphQL query
   - Use `id_in` filter for specific IDs
   - Use pagination for full dataset

2. **Caching**
   - Payout vectors are immutable once set
   - Cache in ClickHouse with ReplacingMergeTree
   - No need to re-fetch resolved conditions

3. **Rate Limits**
   - No published limits on Goldsky subgraphs
   - Data API: ~1000 calls/hour
   - Consider exponential backoff on errors

4. **Parallel Processing**
   - Can run multiple GraphQL queries in parallel
   - Recommended: 5-10 concurrent requests
   - Use Promise.all() for batching

---

## Support & Resources

- **GraphQL Playground:** Visit the endpoint URL in browser
- **Schema Docs:** Click "Docs" in GraphQL playground
- **GitHub Issues:** [Polymarket Subgraph](https://github.com/Polymarket/polymarket-subgraph/issues)
- **Discord:** #devs channel in Polymarket Discord

---

**Last Updated:** 2025-11-09
**Status:** Production Ready
