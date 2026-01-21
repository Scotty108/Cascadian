/**
 * Find PnL Discrepancies Script
 *
 * Identifies wallets where canonical fills exist but positions are missing or have incorrect PnL.
 * This helps detect:
 * 1. Token mapping gaps (trades in pm_trader_events but not in canonical fills)
 * 2. Position rebuild gaps (trades in canonical fills but not in positions table)
 * 3. PnL calculation errors
 *
 * Usage: npx tsx scripts/find-pnl-discrepancies.ts [--fix] [--limit N]
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface DiscrepancyResult {
  wallet: string;
  positions_pnl: number;
  canonical_pnl: number;
  diff: number;
  positions_count: number;
  canonical_positions_count: number;
  missing_positions: number;
}

async function findDiscrepancies(limit: number = 100, daysBack: number = 7): Promise<DiscrepancyResult[]> {
  console.log('='.repeat(60));
  console.log('PnL Discrepancy Finder');
  console.log(`Analyzing wallets active in last ${daysBack} days`);
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Find recently active wallets and check for discrepancies
  console.log('Step 1: Finding recently active wallets with potential discrepancies...');

  // First, find wallets with recent activity (limit to 2000 for performance)
  const activeWalletsQuery = `
    SELECT DISTINCT wallet
    FROM pm_canonical_fills_v4
    WHERE event_time >= now() - INTERVAL ${daysBack} DAY
      AND source IN ('clob', 'ctf_token', 'ctf_cash')
      AND abs(usdc_delta) > 50
    LIMIT 2000
  `;

  const activeResult = await clickhouse.query({
    query: activeWalletsQuery,
    format: 'JSONEachRow'
  });
  const activeWallets = (await activeResult.json() as any[]).map(r => r.wallet);
  console.log(`  Found ${activeWallets.length} recently active wallets`);

  if (activeWallets.length === 0) {
    return [];
  }

  // Process in batches to avoid memory/timeout issues
  const batchSize = 50; // Smaller batches for reliability
  const allDiscrepancies: DiscrepancyResult[] = [];

  for (let i = 0; i < activeWallets.length; i += batchSize) {
    const batch = activeWallets.slice(i, i + batchSize);
    const walletsStr = batch.map(w => `'${w}'`).join(',');

    // Only compare RESOLVED positions to avoid methodology differences on unrealized PnL
    const query = `
      WITH
        -- Canonical fills aggregated by position (only resolved markets)
        canonical AS (
          SELECT
            c.wallet,
            c.condition_id,
            c.outcome_index,
            sum(c.tokens_delta) as net_tokens,
            sum(c.usdc_delta) as net_cash,
            r.payout_numerators
          FROM pm_canonical_fills_v4 c FINAL
          JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE c.wallet IN (${walletsStr})
            AND c.source IN ('clob', 'ctf_token', 'ctf_cash')
            AND r.payout_numerators != '' AND r.payout_numerators != '[1,1]'
          GROUP BY c.wallet, c.condition_id, c.outcome_index, r.payout_numerators
        ),
        -- Calculate expected PnL for resolved positions
        canonical_pnl AS (
          SELECT
            wallet,
            sum(
              net_cash +
              net_tokens * (
                CASE
                  WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
                  WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0
                  ELSE 0.0
                END
              )
            ) as expected_pnl,
            count() as canonical_positions
          FROM canonical
          GROUP BY wallet
        ),
        -- Positions table PnL (only resolved)
        positions_pnl AS (
          SELECT
            wallet_id as wallet,
            sum(pnl_usd) as actual_pnl,
            count() as positions_count
          FROM wio_positions_v2
          WHERE wallet_id IN (${walletsStr})
            AND is_resolved = 1
          GROUP BY wallet_id
        )
      SELECT
        c.wallet,
        round(ifNull(p.actual_pnl, 0), 2) as positions_pnl,
        round(c.expected_pnl, 2) as canonical_pnl,
        round(c.expected_pnl - ifNull(p.actual_pnl, 0), 2) as diff,
        ifNull(p.positions_count, 0) as positions_count,
        c.canonical_positions as canonical_positions_count,
        toInt32(c.canonical_positions - ifNull(p.positions_count, 0)) as missing_positions
      FROM canonical_pnl c
      LEFT JOIN positions_pnl p ON c.wallet = p.wallet
      WHERE abs(c.expected_pnl - ifNull(p.actual_pnl, 0)) > 100
      ORDER BY abs(c.expected_pnl - ifNull(p.actual_pnl, 0)) DESC
    `;

    try {
      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 60, max_memory_usage: 8000000000 }
      });

      const rows = await result.json() as DiscrepancyResult[];
      allDiscrepancies.push(...rows);

      console.log(`  Processed ${Math.min(i + batchSize, activeWallets.length)}/${activeWallets.length} wallets, found ${allDiscrepancies.length} discrepancies so far...`);
    } catch (err: any) {
      if (err.code === '159') {
        console.log(`  Batch ${i}-${i+batchSize} timed out, continuing with partial results...`);
      } else {
        throw err;
      }
    }
  }

  // Sort and limit
  allDiscrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return allDiscrepancies.slice(0, limit);
}

async function findMissingTokenMappings(): Promise<void> {
  console.log('');
  console.log('Step 2: Finding trades missing token mappings...');

  const query = `
    SELECT
      t.token_id,
      count() as trade_count,
      sum(t.usdc_amount) / 1e6 as total_volume
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE m.condition_id IS NULL OR m.condition_id = ''
      AND t.trade_time >= now() - INTERVAL 7 DAY
    GROUP BY t.token_id
    HAVING total_volume > 100
    ORDER BY total_volume DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('  No unmapped tokens with significant volume found.');
  } else {
    console.log(`  Found ${rows.length} unmapped tokens with >$100 volume:`);
    for (const row of rows) {
      console.log(`    Token ${row.token_id.substring(0, 20)}...: ${row.trade_count} trades, $${Number(row.total_volume).toLocaleString()}`);
    }
  }
}

async function findMissingCanonicalFills(): Promise<void> {
  console.log('');
  console.log('Step 3: Finding CLOB trades missing from canonical fills (last 24h)...');

  const query = `
    SELECT
      t.trader_wallet,
      count() as missing_trades,
      sum(t.usdc_amount) / 1e6 as missing_volume
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_canonical_fills_v4 c ON concat('clob_', t.event_id) = c.fill_id
    WHERE c.fill_id IS NULL
      AND m.condition_id != ''
      AND t.trade_time >= now() - INTERVAL 24 HOUR
    GROUP BY t.trader_wallet
    HAVING missing_volume > 100
    ORDER BY missing_volume DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('  No missing canonical fills found (last 24h).');
  } else {
    console.log(`  Found ${rows.length} wallets with missing canonical fills:`);
    for (const row of rows) {
      console.log(`    ${row.trader_wallet}: ${row.missing_trades} trades, $${Number(row.missing_volume).toLocaleString()}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1]) || 100
    : 100;
  const shouldFix = args.includes('--fix');

  try {
    // Find PnL discrepancies
    const discrepancies = await findDiscrepancies(limit);

    console.log('');
    console.log(`Found ${discrepancies.length} wallets with >$100 PnL discrepancy:`);
    console.log('');

    if (discrepancies.length > 0) {
      console.log('Top discrepancies:');
      console.log('-'.repeat(120));
      console.log('| Wallet                                     | Positions PnL | Canonical PnL | Diff        | Positions | Missing |');
      console.log('-'.repeat(120));

      for (const d of discrepancies.slice(0, 20)) {
        const wallet = d.wallet.substring(0, 42);
        const posPnl = d.positions_pnl.toLocaleString().padStart(12);
        const canPnl = d.canonical_pnl.toLocaleString().padStart(12);
        const diff = d.diff.toLocaleString().padStart(10);
        const posCount = d.positions_count.toString().padStart(8);
        const missing = d.missing_positions.toString().padStart(6);
        console.log(`| ${wallet} | $${posPnl} | $${canPnl} | $${diff} | ${posCount} | ${missing} |`);
      }
      console.log('-'.repeat(120));

      // Show summary
      const totalDiscrepancy = discrepancies.reduce((sum, d) => sum + d.diff, 0);
      const totalMissing = discrepancies.reduce((sum, d) => sum + Math.max(0, d.missing_positions), 0);
      console.log('');
      console.log(`Summary:`);
      console.log(`  Total wallets with discrepancy: ${discrepancies.length}`);
      console.log(`  Total PnL discrepancy: $${totalDiscrepancy.toLocaleString()}`);
      console.log(`  Total missing positions: ${totalMissing.toLocaleString()}`);
    }

    // Find missing token mappings
    await findMissingTokenMappings();

    // Find missing canonical fills
    await findMissingCanonicalFills();

    console.log('');
    console.log('='.repeat(60));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(60));

    if (shouldFix && discrepancies.length > 0) {
      console.log('');
      console.log('To fix these discrepancies:');
      console.log('1. Run: npx tsx scripts/cron/update-canonical-fills.ts');
      console.log('2. Run: npx tsx scripts/rebuild-wio-positions-v2.ts');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
