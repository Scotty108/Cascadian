/**
 * Find Top Unmapped Tokens by Volume
 *
 * Identifies which token_ids are missing from the mapping table
 * and contributing to coverage gaps.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function main() {
  console.log('='.repeat(100));
  console.log('UNMAPPED TOKENS ANALYSIS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Wallet:', WALLET);
  console.log('');

  // Find top unmapped tokens by volume using LEFT ANTI JOIN
  // Note: In ClickHouse, regular LEFT JOIN doesn't produce NULLs for missing rows
  // unless join_use_nulls=1. LEFT ANTI JOIN is the correct pattern.
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) AS token_id,
        any(abs(toFloat64(usdc_amount)) / 1000000.0) AS usdc_abs
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.token_id,
      sum(d.usdc_abs) AS usdc_volume,
      count() AS trade_count
    FROM deduped d
    LEFT ANTI JOIN pm_token_to_condition_map_v5 m
      ON d.token_id = m.token_id_dec
    GROUP BY d.token_id
    ORDER BY usdc_volume DESC
    LIMIT 50
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    console.log('All tokens are mapped! No coverage gaps.');
    return;
  }

  // Summary stats
  const totalUnmappedVolume = rows.reduce((s, r) => s + Number(r.usdc_volume), 0);
  const totalUnmappedTrades = rows.reduce((s, r) => s + Number(r.trade_count), 0);

  console.log('--- Summary ---');
  console.log(`Unmapped tokens (top 50): ${rows.length}`);
  console.log(`Total unmapped volume: ${formatUSD(totalUnmappedVolume)}`);
  console.log(`Total unmapped trades: ${totalUnmappedTrades.toLocaleString()}`);
  console.log('');

  // Top unmapped tokens
  console.log('--- Top Unmapped Tokens by Volume ---');
  console.log('');
  console.log('| Token ID (20)            | Volume        | Trades |');
  console.log('|--------------------------|---------------|--------|');

  for (const r of rows.slice(0, 25)) {
    const tokenShort = r.token_id.slice(0, 20) + '..';
    const volume = formatUSD(Number(r.usdc_volume));
    const trades = Number(r.trade_count);
    console.log(`| ${tokenShort.padEnd(24)} | ${volume.padStart(13)} | ${String(trades).padStart(6)} |`);
  }

  console.log('');

  // Output token IDs for backfill
  console.log('--- Token IDs for Backfill (top 10 by volume) ---');
  console.log('');
  for (const r of rows.slice(0, 10)) {
    console.log(`  '${r.token_id}',  // ${formatUSD(Number(r.usdc_volume))} volume`);
  }

  console.log('');
  console.log('='.repeat(100));
}

main().catch(console.error);
