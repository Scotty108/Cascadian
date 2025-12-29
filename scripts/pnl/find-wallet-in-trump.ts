/**
 * Find wallet in Trump trades - investigating data attribution
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function investigate() {
  console.log('='.repeat(80));
  console.log('FINDING OUR WALLET IN TRUMP TRADES');
  console.log('='.repeat(80));

  // 1. Get the actual token IDs from the Trump condition
  const tokensQ = `
    SELECT token_id_dec, outcome_index
    FROM pm_token_to_condition_map_v3
    WHERE condition_id = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917'
  `;
  const tokensR = await clickhouse.query({ query: tokensQ, format: 'JSONEachRow' });
  const tokens = (await tokensR.json()) as any[];
  const tokenList = tokens.map((t) => "'" + t.token_id_dec + "'").join(',');

  // 2. Search for our wallet specifically
  console.log('\n--- Searching for our wallet in Trump trades ---');
  const searchQ = `
    SELECT
      trader_wallet,
      countDistinct(event_id) as unique_trades,
      count() as raw_rows,
      sum(usdc_amount)/1e6 as usdc
    FROM pm_trader_events_v2
    WHERE token_id IN (${tokenList})
      AND is_deleted = 0
      AND lower(trader_wallet) LIKE '%418db17%'
    GROUP BY trader_wallet
  `;

  const searchR = await clickhouse.query({ query: searchQ, format: 'JSONEachRow' });
  const results = (await searchR.json()) as any[];

  console.log('Wallets matching *418db17*:');
  for (const r of results) {
    console.log(`  ${r.trader_wallet}: ${r.unique_trades} trades, $${r.usdc.toFixed(2)}`);
  }

  // 3. Check exact wallet
  console.log('\n--- Exact wallet check ---');
  const exactQ = `
    SELECT count() as cnt, sum(usdc_amount)/1e6 as usdc
    FROM pm_trader_events_v2
    WHERE token_id IN (${tokenList})
      AND is_deleted = 0
      AND lower(trader_wallet) = lower('${WALLET}')
  `;

  const exactR = await clickhouse.query({ query: exactQ, format: 'JSONEachRow' });
  const exact = ((await exactR.json()) as any[])[0];
  console.log(`Exact match for ${WALLET}: ${exact.cnt} rows, $${exact.usdc?.toFixed(2) || 0}`);

  // 4. Show actual wallet address format
  console.log('\n--- Wallet address format in DB ---');
  const formatQ = `
    SELECT DISTINCT trader_wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND lower(trader_wallet) LIKE '%418db17%'
    LIMIT 5
  `;

  const formatR = await clickhouse.query({ query: formatQ, format: 'JSONEachRow' });
  const formats = (await formatR.json()) as any[];
  console.log('Wallet formats in DB:');
  for (const f of formats) {
    console.log(`  '${f.trader_wallet}'`);
  }

  // 5. Compare to UI benchmark wallet
  console.log('\n--- Comparing to benchmark wallet ---');
  console.log('Benchmark wallet: 0x418db17eaa8f25eaf2085657d0becd82462c6786');
  console.log('Database wallet:  ' + (formats[0]?.trader_wallet || 'NOT FOUND'));

  if (formats.length > 0 && formats[0].trader_wallet.toLowerCase() !== WALLET.toLowerCase()) {
    console.log('\n*** WALLET MISMATCH DETECTED ***');
  }

  // 6. Check total trades for this wallet (all markets)
  console.log('\n--- Total wallet stats ---');
  const totalQ = `
    SELECT
      count() as raw_rows,
      countDistinct(event_id) as unique_trades,
      sum(usdc_amount)/1e6 as total_usdc,
      countDistinct(token_id) as unique_tokens
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
  `;

  const totalR = await clickhouse.query({ query: totalQ, format: 'JSONEachRow' });
  const total = ((await totalR.json()) as any[])[0];
  console.log(`Raw rows: ${total.raw_rows}`);
  console.log(`Unique trades: ${total.unique_trades}`);
  console.log(`Total USDC: $${total.total_usdc.toFixed(2)}`);
  console.log(`Unique tokens: ${total.unique_tokens}`);
}

investigate().catch(console.error);
