#!/usr/bin/env npx tsx
/**
 * GENERATE TIER A VERIFIED WALLETS
 * ============================================================================
 *
 * Generates a list of wallets that meet "Tier A Verified" criteria:
 * 1. Tier A classification (high CLOB volume + activity)
 * 2. Unresolved percentage <= threshold (default 5%)
 * 3. (Future: tooltip parity within tolerance once validated at scale)
 *
 * Rule-based definition:
 * - tier = 'A'
 * - unresolved_pct <= 5%
 * - event_count >= 100 (minimum activity)
 *
 * Output: tmp/tierA_verified_wallets_v1.json
 *
 * Usage:
 *   npx tsx scripts/pnl/generate-tierA-verified-wallets.ts
 *   npx tsx scripts/pnl/generate-tierA-verified-wallets.ts --threshold=3
 *   npx tsx scripts/pnl/generate-tierA-verified-wallets.ts --limit=1000
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://pxfuc4pp2e.us-east-1.aws.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface TierAVerifiedWallet {
  wallet_address: string;
  tier: string;
  clob_volume_usdc: number;
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_pct: number;
  realized_pnl_v12: number | null;
  profitable: boolean | null;
}

interface TierAVerifiedOutput {
  metadata: {
    generated_at: string;
    version: string;
    criteria: {
      tier: string;
      unresolved_threshold_pct: number;
      min_event_count: number;
    };
    description: string;
  };
  summary: {
    total_wallets: number;
    profitable_count: number;
    unprofitable_count: number;
    unknown_pnl_count: number;
    total_realized_pnl: number;
    avg_unresolved_pct: number;
    median_unresolved_pct: number;
  };
  wallets: TierAVerifiedWallet[];
}

function parseArgs(): { unresolvedThreshold: number; minEventCount: number; limit: number; outputFile: string } {
  const args = process.argv.slice(2);
  let unresolvedThreshold = 5; // 5% default
  let minEventCount = 100;
  let limit = 10000;
  let outputFile = 'tmp/tierA_verified_wallets_v1.json';

  for (const arg of args) {
    if (arg.startsWith('--threshold=')) {
      unresolvedThreshold = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--min-events=')) {
      minEventCount = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    }
  }

  return { unresolvedThreshold, minEventCount, limit, outputFile };
}

async function main() {
  const { unresolvedThreshold, minEventCount, limit, outputFile } = parseArgs();

  console.log('═'.repeat(80));
  console.log('TIER A VERIFIED WALLET GENERATOR');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Criteria:');
  console.log(`  - Tier: A (high CLOB volume)`);
  console.log(`  - Unresolved %: <= ${unresolvedThreshold}%`);
  console.log(`  - Min events: >= ${minEventCount}`);
  console.log(`  - Limit: ${limit}`);
  console.log('');

  // Query to find Tier A wallets with unresolved stats
  // Using the same resolution join pattern as V12 engine:
  // pm_trader_events_v2 → pm_token_to_condition_map_v5 → pm_condition_resolutions
  const query = `
    WITH wallet_events AS (
      -- Dedup events and join to resolution
      SELECT
        trader_wallet,
        event_id,
        usdc_amount / 1000000.0 as usdc_amt,
        CASE
          WHEN res.payout_numerators IS NOT NULL AND res.payout_numerators != '' AND map.outcome_index IS NOT NULL
          THEN 1
          ELSE 0
        END as is_resolved
      FROM (
        SELECT
          event_id,
          argMax(trader_wallet, trade_time) as trader_wallet,
          argMax(token_id, trade_time) as token_id,
          argMax(usdc_amount, trade_time) as usdc_amount
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY event_id
      ) te
      LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
      LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    ),
    wallet_stats AS (
      SELECT
        trader_wallet,
        count() as event_count,
        sum(usdc_amt) as clob_volume_usdc,
        countIf(is_resolved = 1) as resolved_events,
        countIf(is_resolved = 0) as unresolved_events
      FROM wallet_events
      GROUP BY trader_wallet
      HAVING clob_volume_usdc >= 100000  -- Tier A threshold: $100K+ volume
    )
    SELECT
      trader_wallet as wallet_address,
      'A' as tier,
      clob_volume_usdc,
      event_count,
      resolved_events,
      unresolved_events,
      CASE
        WHEN event_count > 0
        THEN (unresolved_events * 100.0 / event_count)
        ELSE 0
      END as unresolved_pct
    FROM wallet_stats
    WHERE event_count >= ${minEventCount}
      AND (unresolved_events * 100.0 / event_count) <= ${unresolvedThreshold}
    ORDER BY clob_volume_usdc DESC
    LIMIT ${limit}
  `;

  console.log('Querying ClickHouse for Tier A Verified wallets...');
  console.log('');

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });

    const rows = await result.json<TierAVerifiedWallet[]>();

    console.log(`Found ${rows.length} wallets meeting Tier A Verified criteria`);
    console.log('');

    // Calculate summary stats
    const unresolvedPcts = rows.map(r => r.unresolved_pct).sort((a, b) => a - b);
    const medianIdx = Math.floor(unresolvedPcts.length / 2);
    const medianUnresolvedPct = unresolvedPcts.length > 0
      ? (unresolvedPcts.length % 2 === 0
          ? (unresolvedPcts[medianIdx - 1] + unresolvedPcts[medianIdx]) / 2
          : unresolvedPcts[medianIdx])
      : 0;

    const avgUnresolvedPct = rows.length > 0
      ? rows.reduce((sum, r) => sum + r.unresolved_pct, 0) / rows.length
      : 0;

    // Format wallets for output (PnL to be added later via V12 computation)
    const wallets: TierAVerifiedWallet[] = rows.map(row => ({
      wallet_address: row.wallet_address,
      tier: 'A',
      clob_volume_usdc: row.clob_volume_usdc,
      event_count: row.event_count,
      resolved_events: row.resolved_events,
      unresolved_events: row.unresolved_events,
      unresolved_pct: row.unresolved_pct,
      realized_pnl_v12: null, // To be computed separately
      profitable: null, // To be computed separately
    }));

    const output: TierAVerifiedOutput = {
      metadata: {
        generated_at: new Date().toISOString(),
        version: 'v1',
        criteria: {
          tier: 'A',
          unresolved_threshold_pct: unresolvedThreshold,
          min_event_count: minEventCount,
        },
        description: `Tier A Verified wallets: high CLOB volume (>=$100K), unresolved <= ${unresolvedThreshold}%, events >= ${minEventCount}. PnL to be computed via V12 engine.`,
      },
      summary: {
        total_wallets: wallets.length,
        profitable_count: 0, // Unknown until V12 computed
        unprofitable_count: 0,
        unknown_pnl_count: wallets.length,
        total_realized_pnl: 0,
        avg_unresolved_pct: avgUnresolvedPct,
        median_unresolved_pct: medianUnresolvedPct,
      },
      wallets,
    };

    // Save to file
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`Saved to: ${outputFile}`);
    console.log('');

    // Print summary
    console.log('═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`Total Tier A Verified wallets: ${wallets.length}`);
    console.log(`Avg unresolved %: ${avgUnresolvedPct.toFixed(2)}%`);
    console.log(`Median unresolved %: ${medianUnresolvedPct.toFixed(2)}%`);
    console.log('');

    // Show top 10 by volume
    console.log('Top 10 by CLOB Volume:');
    console.log('─'.repeat(80));
    for (let i = 0; i < Math.min(10, wallets.length); i++) {
      const w = wallets[i];
      const shortWallet = w.wallet_address.slice(0, 10) + '...' + w.wallet_address.slice(-4);
      console.log(
        `${String(i + 1).padStart(2)}. ${shortWallet} | ` +
        `Vol: $${w.clob_volume_usdc.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} | ` +
        `Events: ${w.event_count.toLocaleString()} | ` +
        `Unres: ${w.unresolved_pct.toFixed(2)}%`
      );
    }
    console.log('');

    // Distribution breakdown
    console.log('Unresolved % Distribution:');
    console.log('─'.repeat(40));
    const under1 = wallets.filter(w => w.unresolved_pct <= 1).length;
    const under2 = wallets.filter(w => w.unresolved_pct > 1 && w.unresolved_pct <= 2).length;
    const under3 = wallets.filter(w => w.unresolved_pct > 2 && w.unresolved_pct <= 3).length;
    const under4 = wallets.filter(w => w.unresolved_pct > 3 && w.unresolved_pct <= 4).length;
    const under5 = wallets.filter(w => w.unresolved_pct > 4 && w.unresolved_pct <= 5).length;

    console.log(`  0-1%:   ${under1} wallets (${(under1 / wallets.length * 100).toFixed(1)}%)`);
    console.log(`  1-2%:   ${under2} wallets (${(under2 / wallets.length * 100).toFixed(1)}%)`);
    console.log(`  2-3%:   ${under3} wallets (${(under3 / wallets.length * 100).toFixed(1)}%)`);
    console.log(`  3-4%:   ${under4} wallets (${(under4 / wallets.length * 100).toFixed(1)}%)`);
    console.log(`  4-5%:   ${under5} wallets (${(under5 / wallets.length * 100).toFixed(1)}%)`);
    console.log('');

    console.log('✅ Tier A Verified wallet list generated successfully');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run V12 engine on these wallets to compute realized PnL');
    console.log('  2. Scale Playwright scraping for tooltip validation');
    console.log('  3. Lock Tier A Verified criteria once parity confirmed');

  } catch (error) {
    console.error('Error querying ClickHouse:', error);
    throw error;
  } finally {
    await client.close();
  }
}

main().catch(console.error);
