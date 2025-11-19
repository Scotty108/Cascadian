#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('═'.repeat(80));
  console.log('XI MARKET DATA QUALITY INVESTIGATION');
  console.log('═'.repeat(80));
  console.log('');

  // Check 1: Sample raw trade data
  console.log('SAMPLE TRADES (First 20):');
  console.log('─'.repeat(80));

  const sampleQuery = `
    SELECT
      timestamp,
      trade_direction,
      shares,
      price,
      usd_value,
      asset_id,
      outcome_index
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
    ORDER BY timestamp ASC
    LIMIT 20
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json() as any[];

  for (const row of sampleData) {
    const ts = row.timestamp.split(' ')[0];
    const dir = row.trade_direction.padEnd(4);
    const shares = parseFloat(row.shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const price = parseFloat(row.price).toFixed(4).padStart(8);
    const usd = parseFloat(row.usd_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    console.log(`${ts}  ${dir}  Shares: ${shares}  Price: ${price}  USD: ${usd}  Outcome: ${row.outcome_index || 'N/A'}`);
  }

  // Check 2: Trade direction distribution
  console.log('\n\nTRADE DIRECTION DISTRIBUTION:');
  console.log('─'.repeat(80));

  const directionQuery = `
    SELECT
      trade_direction,
      count(*) AS trade_count,
      sum(shares) AS total_shares,
      sum(usd_value) AS total_usd,
      avg(price) AS avg_price
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
    GROUP BY trade_direction
    ORDER BY trade_direction
  `;

  const directionResult = await clickhouse.query({ query: directionQuery, format: 'JSONEachRow' });
  const directionData = await directionResult.json() as any[];

  for (const row of directionData) {
    console.log(`\n${row.trade_direction}:`);
    console.log(`  Trade Count:  ${parseInt(row.trade_count).toLocaleString()}`);
    console.log(`  Total Shares: ${parseFloat(row.total_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total USD:    $${parseFloat(row.total_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Avg Price:    ${parseFloat(row.avg_price).toFixed(4)}`);
  }

  // Check 3: Outcome distribution
  console.log('\n\nOUTCOME DISTRIBUTION:');
  console.log('─'.repeat(80));

  const outcomeQuery = `
    SELECT
      outcome_index,
      count(*) AS trade_count,
      sum(shares) AS total_shares,
      sum(usd_value) AS total_usd
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
    GROUP BY outcome_index
    ORDER BY outcome_index
  `;

  const outcomeResult = await clickhouse.query({ query: outcomeQuery, format: 'JSONEachRow' });
  const outcomeData = await outcomeResult.json() as any[];

  for (const row of outcomeData) {
    console.log(`\nOutcome ${row.outcome_index || 'NULL'}:`);
    console.log(`  Trades: ${parseInt(row.trade_count).toLocaleString()}`);
    console.log(`  Shares: ${parseFloat(row.total_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  USD:    $${parseFloat(row.total_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  // Check 4: Price distribution
  console.log('\n\nPRICE DISTRIBUTION:');
  console.log('─'.repeat(80));

  const priceQuery = `
    SELECT
      countIf(price < 0.01) AS price_under_1cent,
      countIf(price >= 0.01 AND price < 0.10) AS price_1cent_to_10cent,
      countIf(price >= 0.10 AND price < 0.50) AS price_10cent_to_50cent,
      countIf(price >= 0.50 AND price < 0.90) AS price_50cent_to_90cent,
      countIf(price >= 0.90) AS price_over_90cent,
      min(price) AS min_price,
      max(price) AS max_price,
      avg(price) AS avg_price
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
  `;

  const priceResult = await clickhouse.query({ query: priceQuery, format: 'JSONEachRow' });
  const priceData = await priceResult.json() as any[];
  const p = priceData[0];

  console.log(`  < $0.01:              ${parseInt(p.price_under_1cent).toLocaleString()} trades`);
  console.log(`  $0.01 - $0.10:        ${parseInt(p.price_1cent_to_10cent).toLocaleString()} trades`);
  console.log(`  $0.10 - $0.50:        ${parseInt(p.price_10cent_to_50cent).toLocaleString()} trades`);
  console.log(`  $0.50 - $0.90:        ${parseInt(p.price_50cent_to_90cent).toLocaleString()} trades`);
  console.log(`  > $0.90:              ${parseInt(p.price_over_90cent).toLocaleString()} trades`);
  console.log(`\n  Min Price:  ${parseFloat(p.min_price).toFixed(6)}`);
  console.log(`  Max Price:  ${parseFloat(p.max_price).toFixed(6)}`);
  console.log(`  Avg Price:  ${parseFloat(p.avg_price).toFixed(6)}`);

  // Check 5: Largest trades
  console.log('\n\nLARGEST TRADES BY USD VALUE:');
  console.log('─'.repeat(80));

  const largestQuery = `
    SELECT
      timestamp,
      trade_direction,
      shares,
      price,
      usd_value,
      outcome_index
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
    ORDER BY abs(usd_value) DESC
    LIMIT 10
  `;

  const largestResult = await clickhouse.query({ query: largestQuery, format: 'JSONEachRow' });
  const largestData = await largestResult.json() as any[];

  for (const row of largestData) {
    const ts = row.timestamp.split(' ')[0];
    const dir = row.trade_direction.padEnd(4);
    const shares = parseFloat(row.shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const price = parseFloat(row.price).toFixed(4).padStart(8);
    const usd = parseFloat(row.usd_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    console.log(`${ts}  ${dir}  Shares: ${shares}  Price: ${price}  USD: ${usd}  Outcome: ${row.outcome_index || 'N/A'}`);
  }

  // Check 6: Data source validation
  console.log('\n\nDATA SOURCE VALIDATION:');
  console.log('─'.repeat(80));

  const sourceQuery = `
    SELECT
      countIf(shares IS NULL OR shares = 0) AS zero_shares,
      countIf(price IS NULL OR price = 0) AS zero_price,
      countIf(usd_value IS NULL OR usd_value = 0) AS zero_usd,
      countIf(trade_direction IS NULL OR trade_direction = '') AS null_direction,
      count(*) AS total_trades
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
  `;

  const sourceResult = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceData = await sourceResult.json() as any[];
  const s = sourceData[0];

  console.log(`  Total Trades:         ${parseInt(s.total_trades).toLocaleString()}`);
  console.log(`  Zero/NULL Shares:     ${parseInt(s.zero_shares).toLocaleString()}`);
  console.log(`  Zero/NULL Price:      ${parseInt(s.zero_price).toLocaleString()}`);
  console.log(`  Zero/NULL USD Value:  ${parseInt(s.zero_usd).toLocaleString()}`);
  console.log(`  NULL Direction:       ${parseInt(s.null_direction).toLocaleString()}`);

  console.log('\n');
}

main().catch(console.error);
