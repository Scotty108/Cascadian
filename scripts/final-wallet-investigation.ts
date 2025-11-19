import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigate() {
  console.log('=== FINAL WALLET INVESTIGATION REPORT ===\n');
  console.log(`Target Wallet: ${WALLET}`);
  console.log(`Polymarket UI: https://polymarket.com/profile/${WALLET}\n`);

  // 1. Check system_wallet_map
  console.log('1. WALLET MAPPING CHECK\n');
  const asUser = await clickhouse.query({
    query: `
      SELECT DISTINCT system_wallet
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const asSystemWallet = await clickhouse.query({
    query: `
      SELECT DISTINCT user_wallet
      FROM cascadian_clean.system_wallet_map
      WHERE system_wallet = '${WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const userData = await asUser.json<any>();
  const systemData = await asSystemWallet.json<any>();

  if (userData.length > 0) {
    console.log(`✓ This wallet is a USER wallet with ${userData.length} system wallet(s):`);
    userData.forEach((row: any) => console.log(`  → ${row.system_wallet}`));
  } else {
    console.log('✗ Not found as user_wallet');
  }

  if (systemData.length > 0) {
    console.log(`✓ This wallet is a SYSTEM wallet representing ${systemData.length} user wallet(s):`);
    systemData.forEach((row: any) => console.log(`  ← ${row.user_wallet}`));
  } else {
    console.log('✗ Not found as system_wallet');
  }

  // 2. Search for May egg market with "$4.50"
  console.log('\n2. FINDING MAY EGG MARKET\n');

  // Check gamma_markets
  const gammaEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        outcomes_json,
        closed,
        end_date
      FROM default.gamma_markets
      WHERE (question LIKE '%egg%' OR question LIKE '%Egg%')
        AND (question LIKE '%May%' OR end_date LIKE '2025-05%')
        AND question LIKE '%4.50%'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const gammaData = await gammaEggs.json<any>();
  console.log(`Found ${gammaData.length} matching markets in gamma_markets:`);
  gammaData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id);
    console.log('Question:', m.question);
    console.log('End Date:', m.end_date);
    console.log('Closed:', m.closed);
  });

  // Check api_markets_staging
  const apiEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_slug,
        question,
        volume,
        resolved,
        winning_outcome
      FROM default.api_markets_staging
      WHERE (question LIKE '%egg%' OR question LIKE '%Egg%')
        AND (question LIKE '%May%')
        AND question LIKE '%4.50%'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const apiData = await apiEggs.json<any>();
  console.log(`\nFound ${apiData.length} matching markets in api_markets_staging:`);
  apiData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id);
    console.log('Slug:', m.market_slug);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('Resolved:', m.resolved, '| Winner:', m.winning_outcome);
  });

  // Check dim_markets
  const dimEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        question,
        volume,
        closed,
        resolved_at
      FROM default.dim_markets
      WHERE (question LIKE '%egg%' OR question LIKE '%Egg%')
        AND question LIKE '%May%'
        AND question LIKE '%4.50%'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const dimData = await dimEggs.json<any>();
  console.log(`\nFound ${dimData.length} matching markets in dim_markets:`);
  dimData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id_norm);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('Closed:', m.closed);
  });

  // 3. Check if wallet traded any egg markets
  console.log('\n3. WALLET TRADING HISTORY ON EGG MARKETS\n');

  // Get all egg market condition IDs
  const allEggCids = [...gammaData.map((m: any) => m.condition_id), ...apiData.map((m: any) => m.condition_id)];

  if (allEggCids.length > 0) {
    for (const cid of allEggCids) {
      const normalizedCid = cid.toLowerCase().replace('0x', '');

      // Check trades_raw
      const tradeCheck = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as trades,
            SUM(usd_value) as volume
          FROM default.trades_raw
          WHERE wallet_address = '${WALLET}'
            AND (condition_id = '${cid}' OR condition_id = '${normalizedCid}')
        `,
        format: 'JSONEachRow'
      });

      const trades = await tradeCheck.json<any>();

      if (trades[0].trades > 0) {
        const question = gammaData.find((m: any) => m.condition_id === cid)?.question ||
                        apiData.find((m: any) => m.condition_id === cid)?.question;

        console.log(`✓ TRADED: ${question}`);
        console.log(`  CID: ${cid}`);
        console.log(`  Trades: ${trades[0].trades}, Volume: $${trades[0].volume}\n`);

        // Get P&L
        const pnlCheck = await clickhouse.query({
          query: `
            SELECT realized_pnl_usd
            FROM default.realized_pnl_by_market_final
            WHERE wallet = '${WALLET}'
              AND condition_id_norm = '${normalizedCid}'
          `,
          format: 'JSONEachRow'
        });

        const pnl = await pnlCheck.json<any>();
        if (pnl.length > 0) {
          console.log(`  P&L: $${pnl[0].realized_pnl_usd}`);
        }
      }
    }
  }

  // 4. Get wallet's total P&L breakdown
  console.log('\n4. WALLET P&L SUMMARY\n');

  const pnlSummary = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id_norm) as markets,
        SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) as total_profit,
        SUM(CASE WHEN realized_pnl_usd < 0 THEN realized_pnl_usd ELSE 0 END) as total_loss,
        SUM(realized_pnl_usd) as net_pnl
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const summary = await pnlSummary.json<any>();
  console.log('Markets traded:', summary[0].markets);
  console.log('Total profit:', summary[0].total_profit);
  console.log('Total loss:', summary[0].total_loss);
  console.log('Net P&L:', summary[0].net_pnl);

  // Get top 5 winning markets
  console.log('\n5. TOP 5 WINNING MARKETS\n');
  const topWins = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        realized_pnl_usd
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
      ORDER BY realized_pnl_usd DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const wins = await topWins.json<any>();
  for (const win of wins) {
    const marketInfo = await clickhouse.query({
      query: `
        SELECT question
        FROM default.gamma_markets
        WHERE condition_id = '0x${win.condition_id_norm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const info = await marketInfo.json<any>();
    const question = info[0]?.question || 'Unknown market';

    console.log(`$${win.realized_pnl_usd.toFixed(2).padStart(10)} | ${question.substring(0, 70)}`);
    console.log(`   CID: ${win.condition_id_norm}\n`);
  }
}

investigate().catch(console.error);
