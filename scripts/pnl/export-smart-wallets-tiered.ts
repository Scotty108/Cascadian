#!/usr/bin/env npx tsx
/**
 * Export smart wallet list with tiered confidence based on mapping coverage.
 *
 * Tier A (high confidence): 100% token mapping coverage, V18 PnL computed
 * Tier B (low confidence): Missing token mappings, flagged for review
 *
 * Usage:
 *   npx tsx scripts/pnl/export-smart-wallets-tiered.ts --count=100 --min-volume=1000
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minute timeout for complex queries
});

interface WalletExport {
  wallet_address: string;
  tier: 'A' | 'B';
  total_fills: number;
  mapped_fills: number;
  unmapped_fills: number;
  mapping_coverage: number;
  v18_realized_pnl: number | null;
  clob_trade_count: number;
  confidence_reason: string;
}

async function getMappingCoverage(wallet: string): Promise<{ total: number; mapped: number; unmapped: number }> {
  const query = `
    WITH fills AS (
      SELECT DISTINCT event_id, token_id
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
    )
    SELECT
      count() AS total_fills,
      countIf(m.token_id_dec IS NOT NULL) AS mapped_fills,
      countIf(m.token_id_dec IS NULL) AS unmapped_fills
    FROM fills f
    LEFT JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) return { total: 0, mapped: 0, unmapped: 0 };

  return {
    total: Number(rows[0].total_fills),
    mapped: Number(rows[0].mapped_fills),
    unmapped: Number(rows[0].unmapped_fills),
  };
}

async function computeV18Pnl(wallet: string): Promise<number> {
  // V18 maker-only PnL computation with resolution join
  const query = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens,
        sum(if(side = 'sell', usdc, 0)) - sum(if(side = 'buy', usdc, 0)) as cash_flow
      FROM (
        SELECT
          any(lower(f.side)) as side,
          any(f.token_amount) / 1e6 as tokens,
          any(f.usdc_amount) / 1e6 as usdc,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index
        FROM pm_trader_events_dedup_v2_tbl f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        WHERE lower(f.trader_wallet) = lower('${wallet}')
        AND f.role = 'maker'
        GROUP BY f.event_id
      )
      GROUP BY condition_id, outcome_index
    )
    SELECT
      p.condition_id,
      p.outcome_index,
      p.net_tokens,
      p.cash_flow,
      r.payout_numerators
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) return 0;

  let totalPnl = 0;
  for (const r of rows) {
    let resPrice: number | undefined;
    if (r.payout_numerators) {
      try {
        const payouts = JSON.parse(r.payout_numerators);
        resPrice = payouts[r.outcome_index];
      } catch {}
    }
    if (resPrice !== undefined) {
      totalPnl += Number(r.cash_flow) + Number(r.net_tokens) * resPrice;
    } else {
      // Unresolved: use 0.5 as proxy for unrealized
      totalPnl += Number(r.cash_flow) + Number(r.net_tokens) * 0.5;
    }
  }

  return totalPnl;
}

async function main() {
  const args = process.argv.slice(2);
  const countArg = args.find(a => a.startsWith('--count='));
  const minVolumeArg = args.find(a => a.startsWith('--min-volume='));
  const outputArg = args.find(a => a.startsWith('--output='));

  const count = countArg ? parseInt(countArg.split('=')[1]) : 100;
  const minVolume = minVolumeArg ? parseInt(minVolumeArg.split('=')[1]) : 0;
  const outputFile = outputArg ? outputArg.split('=')[1] : '/tmp/smart-wallets-export.csv';

  console.log('='.repeat(80));
  console.log('TIERED SMART WALLET EXPORT');
  console.log('='.repeat(80));
  console.log(`Target count: ${count}`);
  console.log(`Min volume: $${minVolume}`);
  console.log(`Output: ${outputFile}`);
  console.log();

  // Get wallets from classification table (CLOB-only for high confidence)
  const walletQuery = `
    SELECT
      c.wallet_address,
      c.clob_trade_count_total as clob_trade_count,
      c.erc1155_transfer_count,
      c.split_merge_count
    FROM wallet_classification_latest c
    WHERE c.erc1155_transfer_count = 0
      AND c.split_merge_count = 0
      AND c.clob_trade_count_total >= 20
    ORDER BY c.clob_trade_count_total DESC
    LIMIT ${count * 2}
  `;

  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
  const wallets = await walletResult.json() as any[];

  console.log(`Fetched ${wallets.length} candidate wallets`);
  console.log();

  const exports: WalletExport[] = [];
  let tierACount = 0;
  let tierBCount = 0;

  for (let i = 0; i < wallets.length && exports.length < count; i++) {
    const w = wallets[i];
    const wallet = w.wallet_address;

    process.stdout.write(`\r[${i + 1}/${wallets.length}] Processing ${wallet.slice(0, 10)}...`);

    // Check mapping coverage
    const coverage = await getMappingCoverage(wallet);

    const mappingPct = coverage.total > 0 ? (coverage.mapped / coverage.total) * 100 : 0;

    let tier: 'A' | 'B';
    let pnl: number | null = null;
    let reason: string;

    if (coverage.unmapped === 0 && coverage.total > 0) {
      // Tier A: Full mapping coverage
      tier = 'A';
      pnl = await computeV18Pnl(wallet);
      reason = '100% mapping coverage';
      tierACount++;
    } else if (coverage.total === 0) {
      // Skip wallets with no fills
      continue;
    } else {
      // Tier B: Missing mappings
      tier = 'B';
      reason = `${coverage.unmapped} unmapped tokens (${(100 - mappingPct).toFixed(1)}% missing)`;
      tierBCount++;
    }

    exports.push({
      wallet_address: wallet,
      tier,
      total_fills: coverage.total,
      mapped_fills: coverage.mapped,
      unmapped_fills: coverage.unmapped,
      mapping_coverage: mappingPct,
      v18_realized_pnl: pnl,
      clob_trade_count: w.clob_trade_count,
      confidence_reason: reason,
    });

    // INCREMENTAL SAVE: Write CSV after each wallet so we can stop anytime
    const header = 'wallet_address,tier,total_fills,mapped_fills,unmapped_fills,mapping_coverage,v18_realized_pnl,clob_trade_count,confidence_reason';
    const rows = exports.map(e =>
      `${e.wallet_address},${e.tier},${e.total_fills},${e.mapped_fills},${e.unmapped_fills},${e.mapping_coverage.toFixed(2)},${e.v18_realized_pnl?.toFixed(2) ?? ''},${e.clob_trade_count},"${e.confidence_reason}"`
    );
    fs.writeFileSync(outputFile, [header, ...rows].join('\n'));
    console.log(` [${tier}] PnL: $${pnl?.toFixed(2) ?? 'N/A'} | Saved ${exports.length} wallets`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('EXPORT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total exported: ${exports.length}`);
  console.log(`Tier A (high confidence): ${tierACount}`);
  console.log(`Tier B (low confidence): ${tierBCount}`);
  console.log();

  // Write CSV
  const header = 'wallet_address,tier,total_fills,mapped_fills,unmapped_fills,mapping_coverage,v18_realized_pnl,clob_trade_count,confidence_reason';
  const rows = exports.map(e =>
    `${e.wallet_address},${e.tier},${e.total_fills},${e.mapped_fills},${e.unmapped_fills},${e.mapping_coverage.toFixed(2)},${e.v18_realized_pnl?.toFixed(2) ?? ''},${e.clob_trade_count},"${e.confidence_reason}"`
  );

  const csv = [header, ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);

  console.log(`Exported to: ${outputFile}`);

  // Also show top 10 Tier A wallets by PnL
  const tierAWallets = exports.filter(e => e.tier === 'A').sort((a, b) => (b.v18_realized_pnl || 0) - (a.v18_realized_pnl || 0));

  if (tierAWallets.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('TOP 10 TIER A WALLETS BY PNL');
    console.log('='.repeat(80));
    console.log('Wallet'.padEnd(44) + 'PnL'.padStart(12) + 'Fills'.padStart(8));
    console.log('-'.repeat(64));

    for (const w of tierAWallets.slice(0, 10)) {
      console.log(
        w.wallet_address.padEnd(44) +
        ('$' + (w.v18_realized_pnl?.toFixed(2) || '0')).padStart(12) +
        w.total_fills.toString().padStart(8)
      );
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
