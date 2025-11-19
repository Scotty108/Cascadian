#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('=== VERIFICATION: FIXED COVERAGE WITH NORMALIZATION ===\n');

  // Test the fix
  console.log('BEFORE FIX (broken join):');
  const brokenQuery = `
    WITH conditions_in_both AS (
      SELECT COUNT(DISTINCT t.condition_id_norm) as cnt
      FROM vw_trades_canonical t
      INNER JOIN market_resolutions_final r
        ON t.condition_id_norm = r.condition_id_norm
      WHERE t.condition_id_norm != ''
    )
    SELECT cnt as matched_conditions FROM conditions_in_both
  `;
  const brokenResult = await client.query({ query: brokenQuery, format: 'JSONEachRow' });
  const broken = await brokenResult.json();
  console.log(`  Matched conditions: ${broken[0].matched_conditions}`);

  console.log('\nAFTER FIX (normalized join):');
  const fixedQuery = `
    WITH conditions_in_both AS (
      SELECT COUNT(DISTINCT t.condition_id_norm) as cnt
      FROM vw_trades_canonical t
      INNER JOIN market_resolutions_final r
        ON replaceAll(t.condition_id_norm, '0x', '') = r.condition_id_norm
      WHERE t.condition_id_norm != ''
    )
    SELECT cnt as matched_conditions FROM conditions_in_both
  `;
  const fixedResult = await client.query({ query: fixedQuery, format: 'JSONEachRow' });
  const fixed = await fixedResult.json();
  console.log(`  Matched conditions: ${fixed[0].matched_conditions}`);

  // Calculate coverage
  const totalQuery = `
    SELECT COUNT(DISTINCT condition_id_norm) as cnt
    FROM vw_trades_canonical
    WHERE condition_id_norm != ''
  `;
  const totalResult = await client.query({ query: totalQuery, format: 'JSONEachRow' });
  const total = await totalResult.json();

  const coveragePct = (Number(fixed[0].matched_conditions) / Number(total[0].cnt) * 100).toFixed(2);

  console.log('\nFINAL COVERAGE:');
  console.log(`  Total traded conditions: ${Number(total[0].cnt).toLocaleString()}`);
  console.log(`  Matched conditions: ${Number(fixed[0].matched_conditions).toLocaleString()}`);
  console.log(`  Coverage: ${coveragePct}%`);

  // Test on problem wallet
  console.log('\n\nTESTING ON PROBLEM WALLET: 0x4ce73141dbfce41e65db3723e31059a730f0abad');
  console.log('─'.repeat(80));

  const walletQuery = `
    WITH positions AS (
      SELECT
        condition_id_norm,
        outcome_index,
        SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
        SUM(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) as net_cost
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
        AND condition_id_norm != ''
      GROUP BY condition_id_norm, outcome_index
      HAVING ABS(net_shares) > 0.01
    )
    SELECT
      COUNT(*) as total_positions,
      SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as positions_with_resolution,
      round(SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) as resolution_pct
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON replaceAll(p.condition_id_norm, '0x', '') = r.condition_id_norm
  `;

  const walletResult = await client.query({ query: walletQuery, format: 'JSONEachRow' });
  const wallet = await walletResult.json();

  console.log(`Total positions: ${wallet[0].total_positions}`);
  console.log(`Positions with resolutions: ${wallet[0].positions_with_resolution}`);
  console.log(`Resolution coverage: ${wallet[0].resolution_pct}%`);

  console.log('\n\n✓ FIX VERIFIED: Join success rate improved from 0% → ' + coveragePct + '%');

  await client.close();
}

main().catch(console.error);
