#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const TEST_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad',
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
  '0x1f0a343513aa6060488fabe96960e6d1e177f7aa',
];

async function main() {
  console.log('INVESTIGATING: Why do wallets have P&L if coverage is only 24.8%?');
  console.log('═'.repeat(80));
  console.log();

  for (const wallet of TEST_WALLETS) {
    console.log(`WALLET: ${wallet}`);
    console.log('─'.repeat(80));

    // 1. Total trades for this wallet
    const totalTrades = await client.query({
      query: `
        SELECT count(*) as total
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet}')
      `,
      format: 'JSONEachRow',
    });
    const total = (await totalTrades.json<any[]>())[0].total;

    // 2. Trades WITH resolutions
    const withResolutions = await client.query({
      query: `
        SELECT count(*) as with_res
        FROM default.vw_trades_canonical t
        INNER JOIN default.market_resolutions_final r
          ON t.condition_id_norm = concat('0x', r.condition_id_norm)
        WHERE lower(t.wallet_address_norm) = lower('${wallet}')
          AND r.payout_denominator > 0
      `,
      format: 'JSONEachRow',
    });
    const withRes = (await withResolutions.json<any[]>())[0].with_res;

    // 3. Trades WITHOUT resolutions
    const without = total - withRes;
    const coverage = (100 * withRes / total).toFixed(1);

    console.log(`  Total trades: ${total.toLocaleString()}`);
    console.log(`  With resolutions: ${withRes.toLocaleString()} (${coverage}%)`);
    console.log(`  Without resolutions: ${without.toLocaleString()}`);
    console.log();

    // 4. Sample missing markets for this wallet
    if (without > 0) {
      console.log(`  Sampling ${Math.min(5, without)} missing markets:`);
      const missing = await client.query({
        query: `
          SELECT DISTINCT t.condition_id_norm, count(*) as trade_count
          FROM default.vw_trades_canonical t
          LEFT JOIN default.market_resolutions_final r
            ON t.condition_id_norm = concat('0x', r.condition_id_norm)
          WHERE lower(t.wallet_address_norm) = lower('${wallet}')
            AND r.condition_id_norm IS NULL
          GROUP BY t.condition_id_norm
          LIMIT 5
        `,
        format: 'JSONEachRow',
      });

      const missingMarkets = await missing.json<any[]>();
      for (const m of missingMarkets) {
        // Check if this market exists in Polymarket API
        const cleanId = m.condition_id_norm.replace('0x', '');
        const url = `https://gamma-api.polymarket.com/markets?id=${cleanId}`;

        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.log(`    ${m.condition_id_norm.substring(0, 20)}... - NOT FOUND (404)`);
            continue;
          }

          const data = await response.json();
          if (!data || data.length === 0) {
            console.log(`    ${m.condition_id_norm.substring(0, 20)}... - NO DATA`);
            continue;
          }

          const market = data[0];
          const hasWinner = market.outcome && market.outcome !== '';
          const status = hasWinner ? 'RESOLVED' : 'UNRESOLVED';
          const question = market.question?.substring(0, 40) || 'Unknown';

          console.log(`    ${m.condition_id_norm.substring(0, 20)}... - ${status}`);
          console.log(`      "${question}..."`);
          console.log(`      Trades: ${m.trade_count}`);
        } catch (e) {
          console.log(`    ${m.condition_id_norm.substring(0, 20)}... - ERROR`);
        }

        await new Promise(r => setTimeout(r, 100));
      }
    }
    console.log();
  }

  // Global check: Are "missing" markets actually resolvable?
  console.log('═'.repeat(80));
  console.log('GLOBAL CHECK: Sampling 100 "missing" markets');
  console.log('═'.repeat(80));

  const globalMissing = await client.query({
    query: `
      SELECT DISTINCT t.condition_id_norm
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON t.condition_id_norm = concat('0x', r.condition_id_norm)
      WHERE r.condition_id_norm IS NULL
        AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });

  const missing = await globalMissing.json<any[]>();

  let resolved = 0;
  let unresolved = 0;
  let notFound = 0;
  let repeating = 0;

  console.log('Checking 100 markets...');
  for (const {condition_id_norm} of missing) {
    const cleanId = condition_id_norm.replace('0x', '');
    const url = `https://gamma-api.polymarket.com/markets?id=${cleanId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        notFound++;
        continue;
      }

      const data = await response.json();
      if (!data || data.length === 0) {
        notFound++;
        continue;
      }

      const market = data[0];
      const hasWinner = market.outcome && market.outcome !== '';

      // Check if it's a repeating market
      const question = (market.question || '').toLowerCase();
      const isRepeating = question.includes('daily') ||
                         question.includes('weekly') ||
                         question.includes('monthly') ||
                         question.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/); // Date pattern

      if (hasWinner) {
        resolved++;
        if (isRepeating) repeating++;
      } else {
        unresolved++;
      }
    } catch (e) {
      notFound++;
    }

    await new Promise(r => setTimeout(r, 50));
  }

  console.log();
  console.log('RESULTS:');
  console.log(`  Resolved: ${resolved} (${(100*resolved/100).toFixed(0)}%)`);
  console.log(`    Of which repeating: ${repeating}`);
  console.log(`  Unresolved: ${unresolved} (${(100*unresolved/100).toFixed(0)}%)`);
  console.log(`  Not found: ${notFound} (${(100*notFound/100).toFixed(0)}%)`);
  console.log();

  const potentiallyRecoverable = resolved;
  const estimatedGlobalRecoverable = Math.round((171263 * resolved) / 100);

  console.log('═'.repeat(80));
  console.log('ANALYSIS');
  console.log('═'.repeat(80));
  console.log();
  console.log(`If ${resolved}% of "missing" markets are actually RESOLVED:`);
  console.log(`  We could recover ~${estimatedGlobalRecoverable.toLocaleString()} more markets!`);
  console.log(`  New coverage would be: ~${(100 * (56575 + estimatedGlobalRecoverable) / 227838).toFixed(1)}%`);
  console.log();

  if (resolved > 10) {
    console.log('🚨 SMOKING GUN:');
    console.log('   Many "missing" markets ARE RESOLVED in the API!');
    console.log('   The problem is NOT unresolved markets.');
    console.log('   The problem is a BUG in our data pipeline or view!');
  } else {
    console.log('✅ CONFIRMED:');
    console.log('   Most "missing" markets are genuinely unresolved.');
    console.log('   24.8% coverage is close to maximum achievable.');
  }

  await client.close();
}

main().catch(console.error);
