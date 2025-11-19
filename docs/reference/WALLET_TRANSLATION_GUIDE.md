# Wallet Translation Guide: UI → On-Chain → Metrics

**Purpose**: Translate Polymarket UI wallet addresses to on-chain addresses and query P&L/metrics from ClickHouse

**Last Updated**: November 10, 2025

---

## Quick Start

**Single command translation**:

```bash
npx tsx translate-ui-wallet-to-onchain.ts <ui_wallet_address>
```

**Example**:
```bash
npx tsx translate-ui-wallet-to-onchain.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
```

---

## What It Does

### Step 1: Fetch Polymarket API Mapping

Calls: `https://data-api.polymarket.com/positions?user=<wallet>`

**Returns**:
- `user`: UI wallet (may be null if wallet trades directly)
- `proxyWallet`: Actual on-chain trading address
- `positions`: Array of active positions with market info

**Two scenarios**:

**A. Wallet uses proxy architecture** (user ≠ proxyWallet):
```
UI Wallet:    0xabc...123 (shown in Polymarket UI)
Proxy Wallet: 0xdef...456 (actual on-chain trader)
```

**B. Wallet trades directly** (user = null or user = proxyWallet):
```
UI Wallet:    0xcce...58b (same as on-chain)
Proxy Wallet: 0xcce...58b (no proxy)
```

---

### Step 2: Fetch Gamma Profile (Optional)

Calls: `https://gamma-api.polymarket.com/user-profile?wallet=<wallet>`

**Returns**:
- `username`: Profile username (e.g., "TradingPro")
- `slug`: URL-friendly slug for profile link
- `displayName`: Display name (may be different from username)

**Note**: Not all wallets have Gamma profiles (may return 404).

---

### Step 3: Query ClickHouse Metrics

Uses the **proxy wallet** address to query ClickHouse:

**Metrics calculated**:
1. **Basic Stats**:
   - Total trades count
   - Unique markets traded
   - Total cashflow (sum of all USDC in/out)
   - First and last trade timestamps

2. **P&L Calculation**:
   - **Realized P&L**: Sum of cashflow_usdc (trading profits/losses)
   - **Unrealized P&L**: Value of current positions at resolution prices
   - **Total P&L**: Realized + Unrealized

3. **Resolution Coverage**:
   - % of markets that have resolution data
   - Used to assess data quality

**Token filter applied**: All queries include `WHERE length(replaceAll(condition_id, '0x', '')) = 64` to exclude token_* placeholders.

---

### Step 4: Store Mapping

Creates and populates `default.wallet_ui_map` table:

```sql
CREATE TABLE default.wallet_ui_map (
  ui_wallet String,
  proxy_wallet String,
  username Nullable(String),
  display_name Nullable(String),
  profile_slug Nullable(String),
  fetched_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY ui_wallet
```

**Purpose**: Cache mappings for fast lookups without hitting Polymarket API.

---

## Example Output

```
=== POLYMARKET UI WALLET → ON-CHAIN TRANSLATOR ===

Input UI Wallet: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b

=== STEP 1: Fetch Polymarket API Mapping ===

✅ Mapping found:
   UI Wallet:      0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
   Proxy Wallet:   0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
   Active positions: 34

ℹ️  UI wallet = Proxy wallet (no proxy architecture for this wallet)

=== STEP 2: Fetch Gamma Profile (Optional) ===

⚠️  Gamma API returned 404 (profile may not exist)

=== STEP 3: Query ClickHouse for On-Chain Metrics ===

--- Basic Stats ---

  Total Trades:    674
  Unique Markets:  141
  Total Cashflow:  $210,582.33
  First Trade:     2024-08-21 14:38:22
  Last Trade:      2025-10-15 00:15:01

--- P&L Calculation ---

  Realized P&L:    $210,582.33
  Unrealized P&L:  $-238,141.04
  Total P&L:       $-27,558.71

--- Resolution Coverage ---

  Resolved Markets: 141 / 141 (100.00%)

=== STEP 4: Store Mapping in ClickHouse ===

✅ Mapping stored in default.wallet_ui_map

=== SUMMARY ===

UI Wallet:        0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
Proxy Wallet:     0xcce2b7c71f21e358b8e5e797e586cbc03160d58b

Database Metrics:
  Total Trades:     674
  Unique Markets:   141
  Total P&L:        $-27,558.71
  Resolution Coverage: 100%

✅ Translation complete!
```

---

## Manual API Calls

### Get UI → Proxy Mapping

```bash
curl "https://data-api.polymarket.com/positions?user=0xcce2b7c71f21e358b8e5e797e586cbc03160d58b" \
  | jq '.[0] | {user, proxyWallet, positions: length}'
```

### Get Profile Info

```bash
curl "https://gamma-api.polymarket.com/user-profile?wallet=0xcce2b7c71f21e358b8e5e797e586cbc03160d58b" \
  | jq '{username, slug, displayName}'
```

### Query Cached Mappings

```sql
SELECT *
FROM default.wallet_ui_map
WHERE ui_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
```

---

## Use Cases

### 1. Dashboard: Show P&L for Polymarket profile

**Input**: User clicks on Polymarket profile link (e.g., `https://polymarket.com/profile/trader123`)

**Steps**:
1. Extract wallet address from profile
2. Run translation script
3. Display metrics in dashboard

### 2. Leaderboard: Rank wallets by P&L

**Input**: List of UI wallet addresses

**Steps**:
1. Batch translate all wallets (parallel API calls)
2. Query ClickHouse for each proxy wallet
3. Sort by total_pnl descending

### 3. Wallet Search: Find on-chain activity for UI wallet

**Input**: Wallet address from Polymarket UI

**Steps**:
1. Check `wallet_ui_map` table for cached mapping
2. If not cached, call translation script
3. Query trades_raw with proxy wallet

---

## Known Limitations

### 1. Database-API Divergence

**Issue**: ClickHouse may not have same trades as Polymarket API

**Example**: Wallet 0xcce2...58b
- API shows: 34 active positions
- Database shows: 141 historical markets (100% resolved)
- **Overlap**: Likely 0% (database stale or different scope)

**Workaround**: Use API for current positions, database for historical P&L.

### 2. Proxy Architecture Edge Cases

**Issue**: Some wallets trade directly (no proxy), API returns `user: null`

**Solution**: Script now handles this by using proxyWallet for both UI and on-chain address.

### 3. Gamma Profile Availability

**Issue**: Not all wallets have Gamma profiles (404 response)

**Solution**: Script gracefully handles 404 and continues without profile info.

---

## Troubleshooting

### "No trades found in database"

**Possible causes**:
1. Database is stale (last update date?)
2. Wallet only traded markets not in our dataset
3. Wrong mapping (check API response)

**Solutions**:
- Check last_trade timestamp vs current date
- Verify wallet has historical trades on Polymarket UI
- Compare condition_ids from API vs database

### "API Error: 429 Too Many Requests"

**Cause**: Rate limiting on Polymarket API

**Solution**:
- Wait 60 seconds and retry
- Cache mappings in `wallet_ui_map` table
- Batch process wallets with delays

### "Mapping is incorrect"

**Verification**:
```bash
# Check what API returns
curl "https://data-api.polymarket.com/positions?user=<wallet>" | jq '.[0] | {user, proxyWallet}'

# Compare to database
clickhouse-client --query "
  SELECT count()
  FROM trades_raw
  WHERE lower(wallet) = '<proxy_wallet_from_api>'
"
```

---

## Integration Points

### Frontend Dashboard

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getWalletMetrics(uiWallet: string) {
  const { stdout } = await execAsync(
    `npx tsx translate-ui-wallet-to-onchain.ts ${uiWallet}`
  );
  // Parse stdout for metrics
  return {
    totalTrades: extractValue(stdout, 'Total Trades'),
    totalPnl: extractValue(stdout, 'Total P&L'),
    // ... etc
  };
}
```

### API Endpoint

```typescript
// src/app/api/wallet/[address]/metrics/route.ts
export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const uiWallet = params.address;

  // 1. Check cached mapping
  const mapping = await getWalletMapping(uiWallet);

  // 2. Query ClickHouse with proxy wallet
  const metrics = await queryWalletMetrics(mapping.proxy_wallet);

  return Response.json(metrics);
}
```

---

## Files

| File | Purpose |
|------|---------|
| `translate-ui-wallet-to-onchain.ts` | Main translation script |
| `default.wallet_ui_map` | Cached mappings table (ClickHouse) |
| `WALLET_TRANSLATION_GUIDE.md` | This guide |

---

## See Also

- `HANDOFF_CLAUDE1_TO_CLAUDE2.md` - Database status and fixes
- `docs/reference/query-filters-token-exclusion.md` - Token filter pattern
- `docs/reference/market-metadata-schema.md` - Metadata schema reference

---

**Created**: November 10, 2025
**Script**: `translate-ui-wallet-to-onchain.ts`
**Status**: Operational
