#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('DEBUG: PRICE JOIN ISSUE');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check wallet 0xb48e... which should have large positions
  const wallet = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

  // 1. Check open positions
  console.log('1. Checking open positions (without prices)...');
  const positions = await ch.query({
    query: `
      SELECT
        wallet,
        market_cid,
        outcome,
        shares_net AS qty
      FROM (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction='BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
          AND lower(wallet_address_norm) = lower('${wallet}')
        GROUP BY wallet, market_cid, outcome
      )
      WHERE abs(shares_net) >= 0.01
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const posData = await positions.json<any[]>();
  console.log(`Found ${posData.length} open positions for wallet`);
  if (posData.length > 0) {
    console.log('\nSample positions:');
    posData.forEach(p => {
      console.log(`  Market: ${p.market_cid.substring(0, 20)}... Outcome: ${p.outcome}, Shares: ${parseFloat(p.qty).toFixed(2)}`);
    });
  }

  // 2. Check if midprices table has any data
  console.log('\n2. Checking midprices_latest table...');
  const priceCount = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.midprices_latest`,
    format: 'JSONEachRow',
  });
  const pData = await priceCount.json<any[]>();
  console.log(`Total prices in table: ${pData[0].cnt}`);

  // 3. Try to join manually
  if (posData.length > 0) {
    const sample = posData[0];
    console.log(`\n3. Testing join for market ${sample.market_cid}, outcome ${sample.outcome}...`);

    const joinTest = await ch.query({
      query: `
        SELECT
          p.market_cid,
          p.outcome,
          m.midprice,
          m.best_bid,
          m.best_ask
        FROM (
          SELECT '${sample.market_cid}' AS market_cid, ${sample.outcome} AS outcome
        ) p
        LEFT JOIN cascadian_clean.midprices_latest m
          ON m.market_cid = p.market_cid AND m.outcome = p.outcome
      `,
      format: 'JSONEachRow',
    });

    const jData = await joinTest.json<any[]>();
    if (jData.length > 0) {
      console.log('Join result:', jData[0]);
    }
  }

  // 4. Check what's actually in midprices_latest
  console.log('\n4. Sample from midprices_latest...');
  const samplePrices = await ch.query({
    query: `SELECT * FROM cascadian_clean.midprices_latest LIMIT 5`,
    format: 'JSONEachRow',
  });
  const spData = await samplePrices.json<any[]>();
  console.log(`Sample prices:`, spData);

  // 5. Check the actual view definition
  console.log('\n5. Checking vw_positions_open definition...');
  const viewDef = await ch.query({
    query: `SHOW CREATE TABLE cascadian_clean.vw_positions_open`,
    format: 'TabSeparated',
  });
  const vDef = await viewDef.text();
  console.log('View definition:\n', vDef.substring(0, 500), '...');

  console.log('\n');
  await ch.close();
}

main().catch(console.error);
