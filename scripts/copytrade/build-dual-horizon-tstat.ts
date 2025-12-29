/**
 * Dual-Horizon T-Stat Analysis with Maker + Taker
 *
 * Requirements:
 * 1. Resolution-based markout (actual outcomes, not 14-day proxy)
 * 2. Include BOTH maker and taker fills (wallet's complete activity)
 * 3. Calculate lifetime t-stat (all-time)
 * 4. Calculate 30-day t-stat
 * 5. Filter: both high AND 30d > lifetime (improving skilled wallets)
 *
 * Output: Top wallets for Playwright validation
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
const W_MAX = 1000; // Weight cap
const MIN_LIFETIME_FILLS = 50;
const MIN_30D_FILLS = 10;
const MIN_LIFETIME_TSTAT = 2.0; // High bar for proven skill
const MIN_30D_TSTAT = 2.0; // Must also be good recently

async function main() {
  console.log('=== DUAL-HORIZON T-STAT ANALYSIS (MAKER + TAKER) ===\n');
  console.log('Methodology:');
  console.log('  - Resolution-based markout (actual outcomes)');
  console.log('  - Both maker AND taker fills included');
  console.log('  - Lifetime and 30-day t-stats');
  console.log(`  - Filter: lifetime t >= ${MIN_LIFETIME_TSTAT}, 30d t >= ${MIN_30D_TSTAT}, 30d > lifetime`);
  console.log('');

  // Step 1: Build the fills table with resolution-based markout
  console.log('Step 1: Building markout_resolution_fills table...');

  // Drop existing table to rebuild fresh
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS markout_resolution_fills_v2' });
  console.log('  Dropped existing table');

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS markout_resolution_fills_v2
    (
      wallet String,
      event_id String,
      token_id String,
      condition_id String,
      role String,
      side String,
      notional Float64,
      entry_price Float64,
      resolution_price Float64,
      markout_bps Float64,
      weight Float64,
      weight2 Float64,
      trade_time DateTime
    )
    ENGINE = ReplacingMergeTree()
    ORDER BY (wallet, event_id)
  `;

  await clickhouse.command({ query: createTableQuery });
  console.log('  Table created/verified');

  // Step 2: Populate with resolution-based markout data
  console.log('Step 2: Populating with resolution-based markout...');

  const populateQuery = `
    INSERT INTO markout_resolution_fills_v2
    SELECT
      wallet,
      event_id,
      token_id,
      condition_id,
      role,
      side,
      notional,
      entry_price,
      resolution_price,
      markout_bps,
      weight,
      pow(weight, 2) as weight2,
      trade_time
    FROM (
      WITH
      -- Get all resolved markets with their resolution prices
      resolved_markets AS (
        SELECT
          m.condition_id,
          arrayJoin(m.token_ids) as token_id,
          -- payout_numerators is stored as JSON, first element is winning outcome
          toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as resolution_price,
          r.resolved_at
        FROM pm_market_metadata m
        JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        WHERE r.is_deleted = 0
          AND toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 >= 0
          AND toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 <= 1
      ),

      -- Pre-filter trades to resolved markets only
      filtered_trades AS (
        SELECT *
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND token_amount > 0
          AND token_id IN (SELECT token_id FROM resolved_markets)
      ),

      -- Dedupe trades by event_id (handles ingestion duplicates)
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
      )

      -- Join with resolutions and calculate markout
      SELECT
        t.wallet,
        t.event_id,
        t.token_id,
        rm.condition_id,
        t.role,
        t.side,
        t.notional,
        t.entry_price,
        rm.resolution_price,
        -- Markout: direction * (resolution - entry) * 10000 bps
        if(lower(t.side) = 'buy', 1, -1) * (rm.resolution_price - t.entry_price) * 10000 as markout_bps,
        least(sqrt(t.notional), ${W_MAX}) as weight,
        t.trade_time
      FROM deduped_trades t
      JOIN resolved_markets rm ON t.token_id = rm.token_id
      WHERE t.entry_price > 0 AND t.entry_price < 1.0
    )
  `;

  const startTime = Date.now();
  await clickhouse.command({
    query: populateQuery,
    clickhouse_settings: {
      max_execution_time: 1200,
    }
  });
  console.log(`  Populated in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Check row count
  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt, countDistinct(wallet) as wallets FROM markout_resolution_fills_v2',
    format: 'JSONEachRow'
  });
  const countRow = (await countResult.json() as any[])[0];
  console.log(`  Total fills: ${Number(countRow.cnt).toLocaleString()}, Unique wallets: ${Number(countRow.wallets).toLocaleString()}`);

  // Check role distribution
  const roleResult = await clickhouse.query({
    query: 'SELECT role, count() as cnt FROM markout_resolution_fills_v2 GROUP BY role',
    format: 'JSONEachRow'
  });
  const roleRows = await roleResult.json() as any[];
  console.log('  Role distribution:');
  roleRows.forEach((r: any) => console.log(`    ${r.role}: ${Number(r.cnt).toLocaleString()}`));

  // Step 3: Calculate dual-horizon t-stats
  console.log('\nStep 3: Calculating dual-horizon t-stats...');

  const tstatQuery = `
    WITH
    -- Lifetime stats (all data)
    lifetime_stats AS (
      SELECT
        wallet,
        count() as fills,
        countDistinct(condition_id) as markets,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar,
        countIf(role = 'taker') as taker_fills,
        countIf(role = 'maker') as maker_fills
      FROM markout_resolution_fills_v2
      GROUP BY wallet
      HAVING fills >= ${MIN_LIFETIME_FILLS}
    ),

    -- 30-day stats
    d30_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM markout_resolution_fills_v2
      WHERE trade_time >= now() - INTERVAL 30 DAY
      GROUP BY wallet
      HAVING fills >= ${MIN_30D_FILLS}
    )

    SELECT
      lt.wallet,

      -- Lifetime metrics
      lt.fills as lifetime_fills,
      lt.markets as lifetime_markets,
      round(lt.volume, 0) as lifetime_volume,
      round(lt.wmean, 2) as lifetime_mean_bps,
      round((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 2) as lifetime_tstat,
      round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,

      -- 30-day metrics
      d30.fills as d30_fills,
      round(d30.wmean, 2) as d30_mean_bps,
      round((d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)), 2) as d30_tstat,

      -- Improvement ratio
      round(
        (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) /
        nullIf((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 0),
        2
      ) as improvement_ratio

    FROM lifetime_stats lt
    JOIN d30_stats d30 ON lt.wallet = d30.wallet

    WHERE
      -- Positive edge
      lt.wmean > 0
      -- High lifetime t-stat
      AND (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)) >= ${MIN_LIFETIME_TSTAT}
      -- High 30d t-stat
      AND (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) >= ${MIN_30D_TSTAT}
      -- Improving: 30d > lifetime
      AND (d30.wmean / (sqrt(greatest(d30.wvar, 0)) + 1)) * sqrt(pow(d30.tw, 2) / nullIf(d30.tw2, 0)) >
          (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0))

    ORDER BY d30_tstat DESC
    LIMIT 100
  `;

  const tstatResult = await clickhouse.query({
    query: tstatQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const wallets = await tstatResult.json() as any[];

  console.log(`\nFound ${wallets.length} improving high-skill wallets\n`);

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

  // Top 10 with URLs for Playwright validation
  console.log('\n=== TOP 10 FOR PLAYWRIGHT VALIDATION ===\n');

  const topForValidation = wallets.slice(0, 10);
  const validationList: any[] = [];

  for (let i = 0; i < topForValidation.length; i++) {
    const w = topForValidation[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lifetime_tstat} (${w.lifetime_fills} fills, ${w.lifetime_mean_bps} bps avg)`);
    console.log(`   30-day:   t=${w.d30_tstat} (${w.d30_fills} fills, ${w.d30_mean_bps} bps avg)`);
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

  // Export for Playwright validation
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

  // Also create a simple CSV for the validation list
  const csvPath = path.join(exportDir, 'validation_wallets.csv');
  const csvHeader = 'rank,wallet,url,lifetime_tstat,d30_tstat,improvement_ratio,lifetime_fills,d30_fills,maker_pct,volume\n';
  const csvRows = validationList.map(w =>
    `${w.rank},${w.wallet},${w.url},${w.lifetime_tstat},${w.d30_tstat},${w.improvement_ratio},${w.lifetime_fills},${w.d30_fills},${w.maker_pct},${w.volume}`
  ).join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows);
  console.log(`CSV exported to: ${csvPath}`);
}

main().catch(console.error);
