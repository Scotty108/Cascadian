import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

const USER_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function verify() {
  console.log('=== VERIFICATION: Egg Market P&L ===\n');
  console.log('Target: "Will a dozen eggs be below $4.50 in May?"\n');

  // Step 1: Find the exact market
  console.log('STEP 1: Finding market...\n');
  const market = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        outcomes_json,
        closed,
        end_date
      FROM default.gamma_markets
      WHERE question LIKE '%egg%'
        AND question LIKE '%May%'
        AND question LIKE '%4.50%'
        AND question LIKE '%below%'
    `,
    format: 'JSONEachRow'
  });

  const marketData = await market.json<any>();

  if (marketData.length === 0) {
    console.log('ERROR: Market not found!');
    return;
  }

  const m = marketData[0];
  console.log('✓ Found market:');
  console.log(`  Question: ${m.question}`);
  console.log(`  Condition ID: ${m.condition_id}`);
  console.log(`  Closed: ${m.closed}`);
  console.log(`  End Date: ${m.end_date}\n`);

  const cid = m.condition_id;
  const cidNorm = cid.toLowerCase().replace('0x', '');

  // Step 2: Check if user wallet traded this market (via system wallet)
  console.log('STEP 2: Checking trades...\n');

  const trades = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as num_trades,
        SUM(shares) as total_shares,
        SUM(cashflow_usdc) as total_cashflow
      FROM default.trades_raw
      WHERE wallet = '${SYSTEM_WALLET}'
        AND (condition_id = '${cid}' OR condition_id = '${cidNorm}')
    `,
    format: 'JSONEachRow'
  });

  const tradeData = await trades.json<any>();
  console.log(`Trades found: ${tradeData[0].num_trades}`);
  console.log(`Total shares: ${tradeData[0].total_shares}`);
  console.log(`Total cashflow: $${tradeData[0].total_cashflow}\n`);

  if (tradeData[0].num_trades === 0) {
    console.log('⚠️  No trades found for system wallet on this market');
    console.log('   This could mean:');
    console.log('   1. Wallet never traded this specific market');
    console.log('   2. Different market with similar name was traded');
    console.log('   3. Condition ID normalization issue\n');
  } else {
    // Get detailed trades
    console.log('STEP 3: Trade details...\n');
    const tradeDetails = await clickhouse.query({
      query: `
        SELECT
          block_time,
          side,
          shares,
          entry_price,
          cashflow_usdc
        FROM default.trades_raw
        WHERE wallet = '${SYSTEM_WALLET}'
          AND (condition_id = '${cid}' OR condition_id = '${cidNorm}')
        ORDER BY block_time ASC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const details = await tradeDetails.json<any>();
    console.log('Sample trades:');
    details.forEach((t: any, i: number) => {
      console.log(`  ${i + 1}. ${t.block_time} | ${t.side} | ${t.shares} shares @ $${t.entry_price}`);
    });
  }

  // Step 4: Get P&L
  console.log('\nSTEP 4: Checking P&L...\n');

  const pnl = await clickhouse.query({
    query: `
      SELECT
        realized_pnl_usd,
        resolved_at
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${USER_WALLET}'
        AND condition_id_norm = '${cidNorm}'
    `,
    format: 'JSONEachRow'
  });

  const pnlData = await pnl.json<any>();

  if (pnlData.length === 0) {
    console.log('⚠️  No P&L record found');
    console.log('   This means either:');
    console.log('   1. No trades on this market');
    console.log('   2. Market not yet resolved');
    console.log('   3. P&L calculation not run\n');
  } else {
    console.log('✓ P&L found:');
    console.log(`  Realized P&L: $${pnlData[0].realized_pnl_usd}`);
    console.log(`  Resolved at: ${pnlData[0].resolved_at || 'Not resolved'}\n`);
  }

  // Step 5: Check resolution status
  console.log('STEP 5: Market resolution...\n');

  const resolution = await clickhouse.query({
    query: `
      SELECT
        winning_outcome,
        winning_index,
        payout_numerators,
        resolved_at
      FROM default.market_resolutions_final
      WHERE condition_id_norm = '${cidNorm}'
    `,
    format: 'JSONEachRow'
  });

  const resData = await resolution.json<any>();

  if (resData.length === 0) {
    console.log('⚠️  Market not resolved yet');
  } else {
    console.log('✓ Market resolved:');
    console.log(`  Winner: ${resData[0].winning_outcome}`);
    console.log(`  Payout: ${JSON.stringify(resData[0].payout_numerators)}`);
    console.log(`  Resolved: ${resData[0].resolved_at}\n`);
  }

  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Market: ${m.question}`);
  console.log(`User Wallet: ${USER_WALLET}`);
  console.log(`System Wallet: ${SYSTEM_WALLET}`);
  console.log(`Condition ID: ${cid}`);
  console.log(`\nTrades: ${tradeData[0].num_trades}`);
  console.log(`P&L: ${pnlData.length > 0 ? '$' + pnlData[0].realized_pnl_usd : 'Not calculated'}`);
  console.log(`Resolved: ${resData.length > 0 ? 'Yes' : 'No'}`);
}

verify().catch(console.error);
