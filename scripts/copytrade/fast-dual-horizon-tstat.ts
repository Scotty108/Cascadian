/**
 * Fast Dual-Horizon T-Stat Query
 *
 * Calculates lifetime + 90-day t-stats directly without pre-building a table.
 * Only processes resolved markets (filters out unresolved early).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;
const MIN_LIFETIME_FILLS = 50;
const MIN_90D_FILLS = 10;
const MIN_LIFETIME_TSTAT = 2.0;
const MIN_90D_TSTAT = 2.0;

async function main() {
  console.log('=== FAST DUAL-HORIZON T-STAT (DIRECT QUERY) ===\n');

  // Get resolved market count
  const resolvedCount = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const rc = (await resolvedCount.json() as any[])[0];
  console.log(`Resolved markets: ${Number(rc.cnt).toLocaleString()}`);

  console.log('\nRunning combined lifetime + 90-day t-stat query...');
  console.log('(This queries resolved markets only - much faster)\n');

  const query = `
    WITH
    -- Resolved markets with outcomes
    resolved AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as outcome
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.is_deleted = 0
    ),

    -- All trades on resolved markets (deduped)
    trades AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1e6 as notional,
        any(usdc_amount) / nullIf(any(token_amount), 0) as entry_price,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_amount > 0
        AND token_id IN (SELECT token_id FROM resolved)
      GROUP BY event_id
    ),

    -- Calculate markout and weight
    scored AS (
      SELECT
        t.wallet,
        t.role,
        t.notional,
        t.trade_time,
        CASE
          WHEN lower(t.side) = 'buy'
          THEN ((r.outcome / t.entry_price) - 1) * 10000
          ELSE (1 - (r.outcome / t.entry_price)) * 10000
        END as markout_bps,
        least(sqrt(t.notional), ${W_MAX}) as weight
      FROM trades t
      JOIN resolved r ON t.token_id = r.token_id
      WHERE t.entry_price > 0 AND t.entry_price < 1.0
    ),

    -- Lifetime aggregates
    lifetime AS (
      SELECT
        wallet,
        count() as fills,
        countIf(role = 'maker') as maker_fills,
        sum(weight) as sum_w,
        sum(weight * markout_bps) as sum_wx,
        sum(weight * pow(markout_bps, 2)) as sum_wx2,
        sum(notional) as volume
      FROM scored
      GROUP BY wallet
      HAVING fills >= ${MIN_LIFETIME_FILLS}
    ),

    -- 90-day aggregates
    d90 AS (
      SELECT
        wallet,
        count() as fills,
        sum(weight) as sum_w,
        sum(weight * markout_bps) as sum_wx,
        sum(weight * pow(markout_bps, 2)) as sum_wx2
      FROM scored
      WHERE trade_time >= now() - INTERVAL 90 DAY
      GROUP BY wallet
      HAVING fills >= ${MIN_90D_FILLS}
    )

    SELECT
      lt.wallet,
      lt.fills as lifetime_fills,
      round(lt.volume, 0) as volume,
      round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,

      -- Lifetime t-stat
      round(lt.sum_wx / lt.sum_w, 2) as lt_mean_bps,
      round(
        (lt.sum_wx / lt.sum_w) /
        (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
        sqrt(lt.fills),
        2
      ) as lt_tstat,

      -- 90-day t-stat
      d90.fills as d90_fills,
      round(d90.sum_wx / d90.sum_w, 2) as d90_mean_bps,
      round(
        (d90.sum_wx / d90.sum_w) /
        (sqrt(greatest((d90.sum_wx2 / d90.sum_w) - pow(d90.sum_wx / d90.sum_w, 2), 0)) + 1) *
        sqrt(d90.fills),
        2
      ) as d90_tstat

    FROM lifetime lt
    JOIN d90 ON lt.wallet = d90.wallet

    WHERE
      -- Positive lifetime edge
      lt.sum_wx / lt.sum_w > 0
      -- Lifetime t-stat threshold
      AND (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills) >= ${MIN_LIFETIME_TSTAT}
      -- 90d t-stat threshold
      AND (d90.sum_wx / d90.sum_w) /
          (sqrt(greatest((d90.sum_wx2 / d90.sum_w) - pow(d90.sum_wx / d90.sum_w, 2), 0)) + 1) *
          sqrt(d90.fills) >= ${MIN_90D_TSTAT}
      -- Improving: 90d > lifetime
      AND (d90.sum_wx / d90.sum_w) /
          (sqrt(greatest((d90.sum_wx2 / d90.sum_w) - pow(d90.sum_wx / d90.sum_w, 2), 0)) + 1) *
          sqrt(d90.fills) >
          (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills)

    ORDER BY d90_tstat DESC
    LIMIT 100
  `;

  const startTime = Date.now();
  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 10000000000, // 10GB
    }
  });

  const wallets = await result.json() as any[];
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Found ${wallets.length} improving high-skill wallets in ${elapsed}s\n`);

  // Display
  console.log('=== TOP IMPROVING WALLETS (90d > lifetime) ===');
  console.log('Wallet                                     | LT t    | 90d t   | Maker% | LT Fills | 90d Fills');
  console.log('-------------------------------------------|---------|---------|--------|----------|----------');

  for (const w of wallets.slice(0, 30)) {
    const verdict = w.d90_tstat > 5 && w.lt_tstat > 3 ? '✅' :
                    w.d90_tstat > 3 && w.lt_tstat > 2 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lt_tstat).padStart(7)} | ${String(w.d90_tstat).padStart(7)} | ${String(w.maker_pct).padStart(5)}% | ${String(w.lifetime_fills).padStart(8)} | ${String(w.d90_fills).padStart(9)} ${verdict}`
    );
  }

  // Top 10 for validation
  console.log('\n=== TOP 10 FOR VALIDATION ===\n');
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lt_tstat} (${w.lifetime_fills} fills, ${w.lt_mean_bps} bps)`);
    console.log(`   90-day:   t=${w.d90_tstat} (${w.d90_fills} fills, ${w.d90_mean_bps} bps)`);
    console.log(`   Maker %:  ${w.maker_pct}% | Volume: $${Number(w.volume).toLocaleString()}`);
    console.log('');
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    filters: { MIN_LIFETIME_FILLS, MIN_90D_FILLS, MIN_LIFETIME_TSTAT, MIN_90D_TSTAT },
    total_wallets: wallets.length,
    wallets: wallets.map((w: any) => ({
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      lt_tstat: w.lt_tstat,
      d90_tstat: w.d90_tstat,
      lt_fills: w.lifetime_fills,
      d90_fills: w.d90_fills,
      maker_pct: w.maker_pct,
      volume: w.volume,
    })),
  };

  fs.writeFileSync(path.join(exportDir, 'dual_horizon_90d.json'), JSON.stringify(output, null, 2));
  console.log(`Exported to: ${exportDir}/dual_horizon_90d.json`);
}

main().catch(console.error);
