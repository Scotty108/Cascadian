import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigate() {
  console.log('=== PART 1: FIND EGG MARKET ===\n');

  // Search for egg market in gamma_markets (has full descriptions)
  const eggMarket = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        description,
        outcomes_json,
        closed,
        end_date
      FROM default.gamma_markets
      WHERE question LIKE '%egg%' OR question LIKE '%Egg%'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const eggData = await eggMarket.json<any>();
  console.log('Found egg markets:', eggData.length, '\n');
  eggData.forEach((m: any) => {
    console.log('---');
    console.log('Condition ID:', m.condition_id);
    console.log('Question:', m.question);
    console.log('End Date:', m.end_date);
    console.log('Closed:', m.closed);
    console.log('');
  });

  // Also search in dim_markets
  console.log('\n=== CHECKING DIM_MARKETS ===\n');
  const dimEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        market_id,
        question,
        category,
        outcomes,
        closed,
        volume,
        resolved_at
      FROM default.dim_markets
      WHERE question LIKE '%egg%' OR question LIKE '%Egg%'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const dimData = await dimEggs.json<any>();
  console.log('Found in dim_markets:', dimData.length, '\n');
  dimData.forEach((m: any) => {
    console.log('---');
    console.log('Condition ID:', m.condition_id_norm);
    console.log('Market ID:', m.market_id);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('');
  });

  // Also check api_markets_staging
  console.log('\n=== CHECKING API_MARKETS_STAGING ===\n');
  const apiEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_slug,
        question,
        outcomes,
        volume,
        closed,
        resolved,
        winning_outcome,
        end_date
      FROM default.api_markets_staging
      WHERE question LIKE '%egg%' OR question LIKE '%Egg%'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const apiData = await apiEggs.json<any>();
  console.log('Found in api_markets_staging:', apiData.length, '\n');
  apiData.forEach((m: any) => {
    console.log('---');
    console.log('Condition ID:', m.condition_id);
    console.log('Slug:', m.market_slug);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('Resolved:', m.resolved);
    console.log('Winner:', m.winning_outcome);
    console.log('');
  });

  console.log('\n=== PART 2: WALLET TRADES ANALYSIS ===\n');

  // Get wallet's top markets by P&L
  const walletPnl = await clickhouse.query({
    query: `
      SELECT
        market_id,
        condition_id_norm,
        realized_pnl_usd,
        resolved_at
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
      ORDER BY realized_pnl_usd DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const pnlData = await walletPnl.json<any>();
  console.log(`Top 20 markets by P&L for ${WALLET}:\n`);

  let total = 0;
  for (const row of pnlData) {
    total += parseFloat(row.realized_pnl_usd);

    // Try to get market name
    const marketInfo = await clickhouse.query({
      query: `
        SELECT question FROM default.gamma_markets
        WHERE condition_id = '0x${row.condition_id_norm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const info = await marketInfo.json<any>();
    const question = info[0]?.question || 'Unknown';

    console.log(`$${row.realized_pnl_usd.toFixed(2).padStart(12)} | ${question.substring(0, 80)}`);
    console.log(`   CID: ${row.condition_id_norm}`);
  }

  console.log(`\nTotal P&L (top 20): $${total.toFixed(2)}`);

  // Get total P&L for this wallet
  console.log('\n=== PART 3: TOTAL WALLET P&L ===\n');
  const totalPnl = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id_norm) as markets_traded,
        SUM(realized_pnl_usd) as total_pnl,
        MIN(resolved_at) as first_trade,
        MAX(resolved_at) as last_trade
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const totalData = await totalPnl.json<any>();
  console.log('Wallet Stats:');
  console.log('  Markets traded:', totalData[0].markets_traded);
  console.log('  Total P&L:', totalData[0].total_pnl);
  console.log('  First trade:', totalData[0].first_trade);
  console.log('  Last trade:', totalData[0].last_trade);

  // Check if there's a wallet mapping table
  console.log('\n=== PART 4: WALLET MAPPING INVESTIGATION ===\n');
  const walletTables = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        total_rows
      FROM system.tables
      WHERE (database = 'default' OR database = 'cascadian_clean')
        AND (name LIKE '%wallet%' OR name LIKE '%address%' OR name LIKE '%proxy%' OR name LIKE '%relayer%')
      ORDER BY total_rows DESC NULLS LAST
    `,
    format: 'JSONEachRow'
  });

  const walletTableData = await walletTables.json<any>();
  console.log('Found wallet-related tables:', walletTableData.length);
  walletTableData.forEach((t: any) => {
    console.log(`  ${t.database}.${t.name} (${t.total_rows?.toLocaleString() || 0} rows)`);
  });
}

investigate().catch(console.error);
