/**
 * Dual-Horizon T-Stat Analysis - Direct Query Approach
 *
 * Skips intermediate table building - queries directly for efficiency
 * Uses resolution-based markout with maker + taker
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
const W_MAX = 1000;
const MIN_LIFETIME_FILLS = 50;
const MIN_30D_FILLS = 10;
const MIN_LIFETIME_TSTAT = 2.0;
const MIN_30D_TSTAT = 2.0;

async function main() {
  console.log('=== DUAL-HORIZON T-STAT ANALYSIS (DIRECT QUERY) ===\n');
  console.log('Methodology:');
  console.log('  - Resolution-based markout (actual outcomes)');
  console.log('  - Both maker AND taker fills included');
  console.log('  - Lifetime (180 days) and 30-day t-stats');
  console.log(`  - Filter: lifetime t >= ${MIN_LIFETIME_TSTAT}, 30d t >= ${MIN_30D_TSTAT}, 30d > lifetime`);
  console.log('');

  // First, let's check what resolved markets we have
  console.log('Step 1: Checking resolved markets...');
  const resolvedCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total_resolutions,
        countDistinct(condition_id) as unique_markets
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const resolvedRow = (await resolvedCheck.json() as any[])[0];
  console.log(`  Resolved markets: ${Number(resolvedRow.unique_markets).toLocaleString()}`);

  // Check date range of trades
  console.log('\nStep 2: Checking trade data range...');
  const dateCheck = await clickhouse.query({
    query: `
      SELECT
        min(trade_time) as earliest,
        max(trade_time) as latest,
        count() as total_trades
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const dateRow = (await dateCheck.json() as any[])[0];
  console.log(`  Trade range: ${dateRow.earliest} to ${dateRow.latest}`);
  console.log(`  Total trades: ${Number(dateRow.total_trades).toLocaleString()}`);

  // Now run the main query - direct calculation
  console.log('\nStep 3: Computing dual-horizon t-stats (this may take a few minutes)...');

  const mainQuery = `
    WITH
    -- Get resolved markets with resolution prices
    resolved AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as resolution_price
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.is_deleted = 0
    ),

    -- Pre-filter trades to resolved markets (last 180 days for performance)
    filtered_trades AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_amount > 0
        AND trade_time >= now() - INTERVAL 180 DAY
        AND token_id IN (SELECT token_id FROM resolved)
    ),

    -- Dedupe trades by event_id
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
      FROM filtered_trades
      GROUP BY event_id
    ),

    -- Calculate markout for each trade
    trades_with_markout AS (
      SELECT
        t.wallet,
        t.role,
        t.notional,
        t.entry_price,
        r.resolution_price,
        t.trade_time,
        if(lower(t.side) = 'buy', 1, -1) * (r.resolution_price - t.entry_price) * 10000 as markout_bps,
        least(sqrt(t.notional), ${W_MAX}) as weight,
        pow(least(sqrt(t.notional), ${W_MAX}), 2) as weight2
      FROM trades t
      JOIN resolved r ON t.token_id = r.token_id
      WHERE t.entry_price > 0 AND t.entry_price < 1.0
    ),

    -- Lifetime stats
    lifetime AS (
      SELECT
        wallet,
        count() as fills,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar,
        countIf(role = 'maker') as maker_fills
      FROM trades_with_markout
      GROUP BY wallet
      HAVING fills >= ${MIN_LIFETIME_FILLS}
    ),

    -- 30-day stats
    d30 AS (
      SELECT
        wallet,
        count() as fills,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM trades_with_markout
      WHERE trade_time >= now() - INTERVAL 30 DAY
      GROUP BY wallet
      HAVING fills >= ${MIN_30D_FILLS}
    )

    SELECT
      lt.wallet,
      lt.fills as lifetime_fills,
      round(lt.volume, 0) as lifetime_volume,
      round(lt.wmean, 2) as lifetime_mean_bps,
      round((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 2) as lifetime_tstat,
      round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,

      d30.fills as d30_fills,
      round(d30.wmean, 2) as d30_mean_bps,
      round((d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)), 2) as d30_tstat,

      round(
        (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) /
        nullIf((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 0),
        2
      ) as improvement_ratio

    FROM lifetime lt
    JOIN d30 ON lt.wallet = d30.wallet
    WHERE lt.wmean > 0
      AND (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)) >= ${MIN_LIFETIME_TSTAT}
      AND (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) >= ${MIN_30D_TSTAT}
      AND (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) >
          (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0))
    ORDER BY d30_tstat DESC
    LIMIT 100
  `;

  const startTime = Date.now();
  const result = await clickhouse.query({
    query: mainQuery,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 20000000000, // 20GB
    }
  });

  const wallets = await result.json() as any[];
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Query completed in ${elapsed}s`);
  console.log(`  Found ${wallets.length} improving high-skill wallets\n`);

  // Display results
  console.log('=== TOP IMPROVING HIGH-SKILL WALLETS ===');
  console.log('Filter: lifetime t >= 2, 30d t >= 2, 30d > lifetime\n');
  console.log('Wallet                                     | LT t-stat | 30d t-stat | Improve | Maker% | LT Fills | 30d Fills | Volume');
  console.log('-------------------------------------------|-----------|------------|---------|--------|----------|-----------|----------');

  for (const w of wallets.slice(0, 30)) {
    const verdict = w.d30_tstat > 5 && w.lifetime_tstat > 3 ? '✅' :
                    w.d30_tstat > 3 && w.lifetime_tstat > 2 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lifetime_tstat).padStart(9)} | ${String(w.d30_tstat).padStart(10)} | ${String(w.improvement_ratio).padStart(6)}x | ${String(w.maker_pct).padStart(5)}% | ${String(w.lifetime_fills).padStart(8)} | ${String(w.d30_fills).padStart(9)} | $${String(w.lifetime_volume).padStart(8)} ${verdict}`
    );
  }

  // Top 10 with URLs for validation
  console.log('\n=== TOP 10 FOR PLAYWRIGHT VALIDATION ===\n');

  const topForValidation = wallets.slice(0, 10);
  const validationList: any[] = [];

  for (let i = 0; i < topForValidation.length; i++) {
    const w = topForValidation[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lifetime_tstat} (${w.lifetime_fills} fills, ${w.lifetime_mean_bps} bps)`);
    console.log(`   30-day:   t=${w.d30_tstat} (${w.d30_fills} fills, ${w.d30_mean_bps} bps)`);
    console.log(`   Maker %:  ${w.maker_pct}%`);
    console.log(`   Volume:   $${Number(w.lifetime_volume).toLocaleString()}`);
    console.log('');

    validationList.push({
      rank: i + 1,
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      lifetime_tstat: w.lifetime_tstat,
      d30_tstat: w.d30_tstat,
      improvement_ratio: w.improvement_ratio,
      lifetime_fills: w.lifetime_fills,
      d30_fills: w.d30_fills,
      maker_pct: w.maker_pct,
      volume: w.lifetime_volume,
    });
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: 'Dual-horizon t-stat with maker + taker (resolution-based markout)',
      filters: {
        min_lifetime_fills: MIN_LIFETIME_FILLS,
        min_30d_fills: MIN_30D_FILLS,
        min_lifetime_tstat: MIN_LIFETIME_TSTAT,
        min_30d_tstat: MIN_30D_TSTAT,
        requirement: '30d_tstat > lifetime_tstat (improving)',
      },
      includes: 'Both maker and taker fills',
      markout: 'Resolution-based (actual outcomes)',
    },
    total_wallets: wallets.length,
    validation_list: validationList,
    all_results: wallets.map((w: any) => ({
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      lifetime_tstat: w.lifetime_tstat,
      d30_tstat: w.d30_tstat,
      improvement_ratio: w.improvement_ratio,
      lifetime_fills: w.lifetime_fills,
      d30_fills: w.d30_fills,
      lifetime_mean_bps: w.lifetime_mean_bps,
      d30_mean_bps: w.d30_mean_bps,
      maker_pct: w.maker_pct,
      volume: w.lifetime_volume,
    })),
  };

  const outputPath = path.join(exportDir, 'dual_horizon_tstat_v2.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Exported to: ${outputPath}`);

  // CSV for validation
  const csvPath = path.join(exportDir, 'validation_wallets.csv');
  const csvHeader = 'rank,wallet,url,lifetime_tstat,d30_tstat,improvement_ratio,lifetime_fills,d30_fills,maker_pct,volume\n';
  const csvRows = validationList.map(w =>
    `${w.rank},${w.wallet},${w.url},${w.lifetime_tstat},${w.d30_tstat},${w.improvement_ratio},${w.lifetime_fills},${w.d30_fills},${w.maker_pct},${w.volume}`
  ).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows);
  console.log(`CSV exported to: ${csvPath}`);
}

main().catch(console.error);
