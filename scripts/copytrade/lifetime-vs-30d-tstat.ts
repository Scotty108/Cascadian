/**
 * Lifetime vs 30-day T-Stat Analysis
 *
 * Requirements:
 * 1. Lifetime t-stat (all-time skill baseline)
 * 2. 30-day t-stat (recent performance)
 * 3. Filter: 30d t-stat > lifetime t-stat (improving wallets)
 * 4. Taker-only (active trading decisions, not passive fills)
 *
 * NOTE: Maker fills are excluded because they represent passive liquidity,
 * not active prediction signals. For copy trading, we want wallets making
 * intentional market-crossing decisions.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

// Config
const W_MAX = 1000; // Weight cap for t-stat
const MIN_LIFETIME_FILLS = 50;
const MIN_30D_FILLS = 10;
const MIN_LIFETIME_TSTAT = 1.5; // Baseline skill
const MAX_TOTAL_TRADES = 50000; // Filter out bots

interface WalletTStat {
  wallet: string;
  lifetime_fills: number;
  lifetime_mean_bps: number;
  lifetime_tstat: number;
  d30_fills: number;
  d30_mean_bps: number;
  d30_tstat: number;
  improvement_ratio: number;
  maker_pct: number; // For context - how much of their activity is maker
}

async function main() {
  console.log('=== LIFETIME vs 30-DAY T-STAT ANALYSIS ===\n');
  console.log('Filter: taker-only, 30d t-stat > lifetime t-stat (improving wallets)');
  console.log(`Min lifetime fills: ${MIN_LIFETIME_FILLS}, Min 30d fills: ${MIN_30D_FILLS}`);
  console.log(`Min lifetime t-stat: ${MIN_LIFETIME_TSTAT}`);
  console.log('');

  // The query calculates t-stat using resolution-based markout
  // Only includes resolved markets so we know actual outcomes
  const query = `
    WITH
    -- Get all resolved markets
    resolved_markets AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        r.payout_numerators,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as resolution_price
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.is_deleted = 0
    ),

    -- Pre-filter to resolved markets
    filtered_trades AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_amount > 0
        AND token_id IN (SELECT token_id FROM resolved_markets)
    ),

    -- Dedupe trades and get role info
    deduped_trades AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as notional,
        any(usdc_amount) / nullIf(any(token_amount), 0) as entry_price,
        any(trade_time) as trade_time
      FROM filtered_trades
      GROUP BY event_id
    ),

    -- Join with resolutions and calculate markout
    trades_with_markout AS (
      SELECT
        t.wallet,
        t.role,
        t.notional,
        t.entry_price,
        t.trade_time,
        rm.resolution_price,
        if(lower(t.side) = 'buy', 1, -1) as direction,
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * 10000 as markout_bps,
        least(sqrt(t.notional), {w_max:Float64}) as weight
      FROM deduped_trades t
      JOIN resolved_markets rm ON t.token_id = rm.token_id
      WHERE t.entry_price > 0 AND t.entry_price < 1.0
    ),

    -- LIFETIME stats (taker only)
    lifetime_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight * weight) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM trades_with_markout
      WHERE role = 'taker'
      GROUP BY wallet
      HAVING fills >= {min_lifetime_fills:UInt32}
    ),

    -- 30-DAY stats (taker only)
    d30_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(weight) as tw,
        sum(weight * weight) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM trades_with_markout
      WHERE role = 'taker'
        AND trade_time >= now() - INTERVAL 30 DAY
      GROUP BY wallet
      HAVING fills >= {min_30d_fills:UInt32}
    ),

    -- Maker percentage (for context)
    maker_ratio AS (
      SELECT
        wallet,
        countIf(role = 'maker') / count() as maker_pct
      FROM trades_with_markout
      GROUP BY wallet
    ),

    -- Total trades (for bot filtering)
    trade_counts AS (
      SELECT trader_wallet as wallet, count() as total_trades
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING total_trades < {max_trades:UInt64}
    )

    SELECT
      lt.wallet,

      -- Lifetime
      lt.fills as lifetime_fills,
      round(lt.wmean, 2) as lifetime_mean_bps,
      round((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 2) as lifetime_tstat,

      -- 30-day
      d30.fills as d30_fills,
      round(d30.wmean, 2) as d30_mean_bps,
      round((d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)), 2) as d30_tstat,

      -- Improvement ratio
      round(
        (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) /
        nullIf((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 0),
        2
      ) as improvement_ratio,

      -- Maker context
      round(coalesce(mr.maker_pct, 0) * 100, 1) as maker_pct

    FROM lifetime_stats lt
    JOIN d30_stats d30 ON lt.wallet = d30.wallet
    JOIN trade_counts tc ON lt.wallet = tc.wallet
    LEFT JOIN maker_ratio mr ON lt.wallet = mr.wallet

    WHERE
      -- Positive lifetime edge
      lt.wmean > 0
      -- Minimum lifetime t-stat
      AND (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)) >= {min_lt_tstat:Float64}
      -- 30d t-stat > lifetime t-stat (improving)
      AND (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) >
          (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0))
      -- Not a pure market maker
      AND coalesce(mr.maker_pct, 0) < 0.7

    ORDER BY d30_tstat DESC
    LIMIT 100
  `;

  console.log('Running query...');
  const result = await clickhouse.query({
    query,
    query_params: {
      w_max: W_MAX,
      min_lifetime_fills: MIN_LIFETIME_FILLS,
      min_30d_fills: MIN_30D_FILLS,
      min_lt_tstat: MIN_LIFETIME_TSTAT,
      max_trades: MAX_TOTAL_TRADES,
    },
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300,
    },
  });

  const wallets = await result.json() as any[];

  console.log(`\nFound ${wallets.length} improving wallets\n`);

  // Display results
  console.log('=== TOP IMPROVING WALLETS (30d t-stat > lifetime t-stat) ===\n');
  console.log('Wallet                                     | LT t-stat | 30d t-stat | Improve | Maker% | LT Fills | 30d Fills');
  console.log('-------------------------------------------|-----------|------------|---------|--------|----------|----------');

  for (const w of wallets.slice(0, 30)) {
    const verdict = w.d30_tstat > 4 && w.lifetime_tstat > 2 ? '✅' :
                    w.d30_tstat > 2 && w.lifetime_tstat > 1.5 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lifetime_tstat).padStart(9)} | ${String(w.d30_tstat).padStart(10)} | ${String(w.improvement_ratio).padStart(6)}x | ${String(w.maker_pct).padStart(5)}% | ${String(w.lifetime_fills).padStart(8)} | ${String(w.d30_fills).padStart(9)} ${verdict}`
    );
  }

  // Top picks
  console.log('\n=== TOP 10 COPYABLE WALLETS ===\n');
  const topPicks = wallets.filter(w =>
    w.d30_tstat > 2 &&
    w.lifetime_tstat > 1.5 &&
    w.improvement_ratio > 1.0 &&
    w.maker_pct < 50
  ).slice(0, 10);

  for (let i = 0; i < topPicks.length; i++) {
    const w = topPicks[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lifetime_tstat} (${w.lifetime_fills} fills, ${w.lifetime_mean_bps} bps avg)`);
    console.log(`   30-day:   t=${w.d30_tstat} (${w.d30_fills} fills, ${w.d30_mean_bps} bps avg)`);
    console.log(`   Improvement: ${w.improvement_ratio}x | Maker activity: ${w.maker_pct}%`);
    console.log('');
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: 'Improving wallets: 30d t-stat > lifetime t-stat',
      role_filter: 'taker-only (intentional trades, not passive maker fills)',
      filters: {
        min_lifetime_fills: MIN_LIFETIME_FILLS,
        min_30d_fills: MIN_30D_FILLS,
        min_lifetime_tstat: MIN_LIFETIME_TSTAT,
        max_maker_pct: 70,
        max_total_trades: MAX_TOTAL_TRADES,
      },
      rationale: 'Wallets where recent skill exceeds historical average - improving traders',
    },
    total_wallets: wallets.length,
    wallets: wallets.map((w: any) => ({
      wallet: w.wallet,
      lifetime_tstat: w.lifetime_tstat,
      d30_tstat: w.d30_tstat,
      improvement_ratio: w.improvement_ratio,
      lifetime_fills: w.lifetime_fills,
      d30_fills: w.d30_fills,
      lifetime_mean_bps: w.lifetime_mean_bps,
      d30_mean_bps: w.d30_mean_bps,
      maker_pct: w.maker_pct,
      url: `https://polymarket.com/profile/${w.wallet}`,
    })),
  };

  fs.writeFileSync(
    path.join(exportDir, 'improving_wallets_tstat.json'),
    JSON.stringify(output, null, 2)
  );
  console.log(`\nExported to: ${exportDir}/improving_wallets_tstat.json`);
}

main().catch(console.error);
