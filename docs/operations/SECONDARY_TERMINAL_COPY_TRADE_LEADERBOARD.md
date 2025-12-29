# Secondary Terminal Instructions: Copy-Trade Leaderboard (Step 1)

> **Context**: You are in a secondary cloud terminal for the Cascadian app.
> **Assumption**: Our wallet metrics are already correct and trusted.
> **Goal**: Build a fast, ClickHouse-driven top 100 copy-trade candidate list.

---

## Assumptions (Treat as Ground Truth)

1. **Our metrics are canonical** - no need to re-validate against Polymarket UI
2. **`default.wallet_metrics`** is the primary wallet-level metrics source
3. **`default.omega_leaderboard`** is a view over `wallet_metrics` (top 50 by omega)
4. **The data is already populated** from prior backfill runs

---

## Known Schema

### `default.wallet_metrics` (Primary Source)

```sql
CREATE TABLE default.wallet_metrics (
  wallet_address String NOT NULL,
  time_window Enum8('30d'=1, '90d'=2, '180d'=3, 'lifetime'=4) NOT NULL,
  realized_pnl Float64 DEFAULT 0,
  unrealized_payout Float64 DEFAULT 0,
  roi_pct Float64 DEFAULT 0,
  win_rate Float64 DEFAULT 0,
  sharpe_ratio Float64 DEFAULT 0,
  omega_ratio Float64 DEFAULT 0,
  total_trades UInt32 DEFAULT 0,
  markets_traded UInt32 DEFAULT 0,
  calculated_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, time_window)
```

### `default.omega_leaderboard` (View - Top 50 only)

```sql
-- Pulls from wallet_metrics WHERE time_window = 'lifetime'
-- Already filtered: omega_ratio IS NOT NULL AND total_trades >= 10
-- Limited to 50 rows - we need more
```

### `sql/ddl_pm_wallet_summary_v2.sql` (Richer Schema - May Not Be Populated)

Contains additional columns like `max_drawdown_usd`, but **verify it's populated** before using.

---

## Task: Build Copy-Trade Leaderboard Script

### Step 1: Create the Script

**Path**: `scripts/pnl/build-copy-trade-leaderboard-fast-v1.ts`

### Filter Constants (Conservative for Copy-Trade Safety)

```typescript
// Strict filters for copy-trade candidates
const MIN_TRADES = 20;           // Minimum statistical significance
const MIN_MARKETS = 5;           // Diversification requirement
const MIN_WIN_RATE = 0.50;       // At least break-even on win rate
const MIN_OMEGA = 1.0;           // Positive risk-adjusted returns
const MIN_ABS_PNL = 100;         // Filter out dust wallets (absolute value)
const LIMIT = 100;               // Top 100 candidates
```

### Core Query Logic

```sql
SELECT
  wallet_address,
  omega_ratio,
  realized_pnl,
  win_rate,
  roi_pct,
  total_trades,
  markets_traded,
  sharpe_ratio
FROM default.wallet_metrics FINAL
WHERE
  time_window = 'lifetime'
  AND total_trades >= 20
  AND markets_traded >= 5
  AND omega_ratio IS NOT NULL
  AND omega_ratio >= 1.0
  AND win_rate >= 0.50
  AND abs(realized_pnl) >= 100
ORDER BY
  omega_ratio DESC,
  realized_pnl DESC,
  win_rate DESC
LIMIT 100
```

> **Note**: Use `FINAL` to get latest ReplacingMergeTree version.

### Output Format

Write to: `tmp/copy_trade_leaderboard_fast_v1.json`

```json
{
  "generated_at": "2025-12-07T12:00:00Z",
  "filters": {
    "min_trades": 20,
    "min_markets": 5,
    "min_win_rate": 0.50,
    "min_omega": 1.0,
    "min_abs_pnl": 100
  },
  "count": 100,
  "wallets": [
    {
      "rank": 1,
      "wallet": "0x...",
      "omega_ratio": 2.45,
      "realized_pnl": 15234.56,
      "win_rate": 0.72,
      "roi_pct": 34.5,
      "total_trades": 156,
      "markets_traded": 23,
      "sharpe_ratio": 1.8
    },
    // ... 99 more
  ]
}
```

---

## Full Script Template

```typescript
#!/usr/bin/env npx tsx
/**
 * Copy-Trade Leaderboard Builder (Fast V1)
 *
 * Pulls top 100 copy-trade candidates from wallet_metrics.
 * Filters for safety and minimum activity.
 * No per-wallet recompute - pure ClickHouse query.
 *
 * Output: tmp/copy_trade_leaderboard_fast_v1.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '@/lib/clickhouse/client';

// ============================================================================
// FILTER CONSTANTS (Conservative for copy-trade safety)
// ============================================================================
const MIN_TRADES = 20;           // Statistical significance
const MIN_MARKETS = 5;           // Diversification
const MIN_WIN_RATE = 0.50;       // At least break-even
const MIN_OMEGA = 1.0;           // Positive risk-adjusted
const MIN_ABS_PNL = 100;         // Filter dust
const LIMIT = 100;

interface LeaderboardWallet {
  rank: number;
  wallet: string;
  omega_ratio: number;
  realized_pnl: number;
  win_rate: number;
  roi_pct: number;
  total_trades: number;
  markets_traded: number;
  sharpe_ratio: number;
}

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(80));
  console.log('COPY-TRADE LEADERBOARD BUILDER (FAST V1)');
  console.log('='.repeat(80));
  console.log(`\nFilters:`);
  console.log(`  MIN_TRADES:   ${MIN_TRADES}`);
  console.log(`  MIN_MARKETS:  ${MIN_MARKETS}`);
  console.log(`  MIN_WIN_RATE: ${MIN_WIN_RATE}`);
  console.log(`  MIN_OMEGA:    ${MIN_OMEGA}`);
  console.log(`  MIN_ABS_PNL:  $${MIN_ABS_PNL}`);
  console.log(`  LIMIT:        ${LIMIT}\n`);

  try {
    // Step 1: Check table exists and has data
    console.log('1️⃣  Checking wallet_metrics table...');

    const countQuery = `
      SELECT count() as total
      FROM default.wallet_metrics FINAL
      WHERE time_window = 'lifetime'
    `;
    const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    const totalWallets = parseInt(countData[0].total);

    console.log(`   Found ${totalWallets.toLocaleString()} lifetime wallet records\n`);

    if (totalWallets === 0) {
      console.error('❌ ERROR: No data in wallet_metrics. Run rebuild script first.');
      process.exit(1);
    }

    // Step 2: Run leaderboard query
    console.log('2️⃣  Querying top candidates...');
    const startTime = Date.now();

    const leaderboardQuery = `
      SELECT
        wallet_address,
        omega_ratio,
        realized_pnl,
        win_rate,
        roi_pct,
        total_trades,
        markets_traded,
        sharpe_ratio
      FROM default.wallet_metrics FINAL
      WHERE
        time_window = 'lifetime'
        AND total_trades >= ${MIN_TRADES}
        AND markets_traded >= ${MIN_MARKETS}
        AND omega_ratio IS NOT NULL
        AND omega_ratio >= ${MIN_OMEGA}
        AND win_rate >= ${MIN_WIN_RATE}
        AND abs(realized_pnl) >= ${MIN_ABS_PNL}
      ORDER BY
        omega_ratio DESC,
        realized_pnl DESC,
        win_rate DESC
      LIMIT ${LIMIT}
    `;

    const result = await ch.query({ query: leaderboardQuery, format: 'JSONEachRow' });
    const rows = await result.json<any[]>();
    const elapsed = Date.now() - startTime;

    console.log(`   Query completed in ${elapsed}ms`);
    console.log(`   Found ${rows.length} candidates matching filters\n`);

    // Step 3: Transform to output format
    const wallets: LeaderboardWallet[] = rows.map((row, idx) => ({
      rank: idx + 1,
      wallet: row.wallet_address,
      omega_ratio: parseFloat(row.omega_ratio) || 0,
      realized_pnl: parseFloat(row.realized_pnl) || 0,
      win_rate: parseFloat(row.win_rate) || 0,
      roi_pct: parseFloat(row.roi_pct) || 0,
      total_trades: parseInt(row.total_trades) || 0,
      markets_traded: parseInt(row.markets_traded) || 0,
      sharpe_ratio: parseFloat(row.sharpe_ratio) || 0,
    }));

    // Step 4: Write JSON output
    const output = {
      generated_at: new Date().toISOString(),
      filters: {
        min_trades: MIN_TRADES,
        min_markets: MIN_MARKETS,
        min_win_rate: MIN_WIN_RATE,
        min_omega: MIN_OMEGA,
        min_abs_pnl: MIN_ABS_PNL,
      },
      count: wallets.length,
      wallets,
    };

    // Ensure tmp directory exists
    const tmpDir = resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputPath = resolve(tmpDir, 'copy_trade_leaderboard_fast_v1.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`3️⃣  Output written to: ${outputPath}\n`);

    // Step 5: Print summary
    console.log('='.repeat(80));
    console.log('TOP 10 COPY-TRADE CANDIDATES');
    console.log('='.repeat(80));
    console.log('Rank | Wallet                                     | Omega  | PnL         | Win%  | Trades');
    console.log('-'.repeat(80));

    wallets.slice(0, 10).forEach(w => {
      const pnlStr = w.realized_pnl >= 0
        ? `+$${w.realized_pnl.toFixed(0).padStart(8)}`
        : `-$${Math.abs(w.realized_pnl).toFixed(0).padStart(8)}`;
      console.log(
        `${w.rank.toString().padStart(4)} | ${w.wallet} | ${w.omega_ratio.toFixed(2).padStart(6)} | ${pnlStr} | ${(w.win_rate * 100).toFixed(0).padStart(4)}% | ${w.total_trades.toString().padStart(5)}`
      );
    });

    // Aggregate stats
    const totalPnl = wallets.reduce((sum, w) => sum + w.realized_pnl, 0);
    const avgOmega = wallets.length > 0
      ? wallets.reduce((sum, w) => sum + w.omega_ratio, 0) / wallets.length
      : 0;
    const avgWinRate = wallets.length > 0
      ? wallets.reduce((sum, w) => sum + w.win_rate, 0) / wallets.length
      : 0;

    console.log('\n' + '='.repeat(80));
    console.log('AGGREGATE STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total candidates:     ${wallets.length}`);
    console.log(`Combined PnL:         $${totalPnl.toFixed(2)}`);
    console.log(`Average Omega:        ${avgOmega.toFixed(2)}`);
    console.log(`Average Win Rate:     ${(avgWinRate * 100).toFixed(1)}%`);
    console.log(`Profitable wallets:   ${wallets.filter(w => w.realized_pnl > 0).length}`);
    console.log(`Losing wallets:       ${wallets.filter(w => w.realized_pnl < 0).length}`);

    console.log('\n✅ STEP 1 COMPLETE');
    console.log('Next: Use MCP Playwright to validate individual wallets against Polymarket UI');

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
```

---

## Execution

```bash
npx tsx scripts/pnl/build-copy-trade-leaderboard-fast-v1.ts
```

---

## Expected Output

1. **Console**: Summary table of top 10, aggregate stats
2. **File**: `tmp/copy_trade_leaderboard_fast_v1.json` with all 100 candidates

---

## Validation Checklist

- [ ] `tmp/copy_trade_leaderboard_fast_v1.json` exists
- [ ] JSON contains exactly 100 wallets (or fewer if pool is smaller)
- [ ] Each wallet has: `wallet`, `omega_ratio`, `realized_pnl`, `win_rate`, `total_trades`, `markets_traded`
- [ ] No wallets with `total_trades < 20`
- [ ] No wallets with `omega_ratio < 1.0`

---

## Troubleshooting

### If wallet_metrics is empty

```bash
# Check if table exists and has data
npx tsx -e "
import { getClickHouseClient } from './lib/clickhouse/client';
const ch = getClickHouseClient();
const r = await ch.query({ query: 'SELECT count() FROM default.wallet_metrics', format: 'JSONEachRow' });
console.log(await r.json());
await ch.close();
"
```

If empty, run the rebuild script first:
```bash
npx tsx scripts/rebuild-wallet-metrics-complete.ts
```

### If query returns 0 results

Loosen filters incrementally:
1. Try `MIN_OMEGA = 0.5`
2. Try `MIN_TRADES = 10`
3. Try `MIN_WIN_RATE = 0.40`

---

## What Comes Next (Step 2 - NOT YET)

After Step 1 completes:
1. Build MCP Playwright validator script
2. For each wallet in `copy_trade_leaderboard_fast_v1.json`:
   - Navigate to `https://polymarket.com/portfolio/{wallet}`
   - Extract UI-displayed PnL
   - Compare to our `realized_pnl`
   - Log discrepancies

**DO NOT BUILD STEP 2 YET. Complete Step 1 first.**

---

## Notes

- This approach avoids the slow V29 per-wallet recompute path
- It gives a high-quality, low-risk candidate set for copy-trading
- Then your Playwright validator can do expensive per-wallet truth checks only for these 100
- Total runtime: ~5-10 seconds (single ClickHouse query)
