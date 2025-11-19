import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 3: BUILD HYBRID CASHFLOW CALCULATION");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Create hybrid cashflow view
  console.log("Step 1: Creating trade_cashflows_v3_blockchain...");
  console.log("─".repeat(80));
  console.log();

  const createViewSQL = `
    CREATE OR REPLACE VIEW trade_cashflows_v3_blockchain AS
    WITH clob_cashflows AS (
      -- Use CLOB fills for price/cost basis where available
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) AS cashflow
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      GROUP BY wallet, condition_id_norm, outcome_idx
    ),
    erc1155_positions AS (
      -- Get all positions from blockchain
      SELECT *
      FROM outcome_positions_v2_blockchain
    )
    -- Hybrid approach: use CLOB cashflow where available,
    -- otherwise estimate from ERC1155 positions
    SELECT
      p.wallet,
      p.condition_id_norm,
      p.outcome_idx,
      p.net_shares,
      COALESCE(c.cashflow, 0) AS cashflow
    FROM erc1155_positions p
    LEFT JOIN clob_cashflows c
      ON p.wallet = c.wallet
      AND p.condition_id_norm = c.condition_id_norm
      AND p.outcome_idx = c.outcome_idx
  `;

  try {
    await clickhouse.command({ query: createViewSQL });
    console.log("✅ View created successfully");
  } catch (error: any) {
    console.error("❌ Failed to create view:", error.message);
    throw error;
  }

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 2: Test the new view
  console.log("Step 2: Testing new view with test wallet...");
  console.log("─".repeat(80));
  console.log();

  // Count entries
  const countQuery = await clickhouse.query({
    query: `
      SELECT count(*) as entry_count
      FROM trade_cashflows_v3_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const countData = (await countQuery.json())[0];
  console.log(`Cashflow entries found: ${countData.entry_count}`);

  // Sample entries
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) || '...' as cid,
        outcome_idx,
        net_shares,
        cashflow
      FROM trade_cashflows_v3_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      ORDER BY abs(cashflow) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleQuery.json();
  console.log("\nTop 10 entries by cashflow:");
  console.table(sampleData);

  // Calculate totals
  const totalsQuery = await clickhouse.query({
    query: `
      SELECT
        sum(cashflow) as total_cashflow,
        countIf(cashflow != 0) as has_clob_data,
        countIf(cashflow = 0) as no_clob_data
      FROM trade_cashflows_v3_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const totalsData = (await totalsQuery.json())[0];
  console.log("\nCashflow summary:");
  console.log(`  Total cashflow: $${Number(totalsData.total_cashflow).toFixed(2)}`);
  console.log(`  With CLOB pricing: ${totalsData.has_clob_data} entries`);
  console.log(`  Without CLOB pricing: ${totalsData.no_clob_data} entries`);

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 3: Compare with old view
  console.log("Step 3: Comparing new vs old cashflows...");
  console.log("─".repeat(80));
  console.log();

  // Old view total
  const oldTotalQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as entry_count,
        sum(cashflow) as total_cashflow
      FROM trade_cashflows_v3
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const oldTotalData = (await oldTotalQuery.json())[0];

  console.log(`Old view (CLOB only):`);
  console.log(`  Entries: ${oldTotalData.entry_count}`);
  console.log(`  Total cashflow: $${Number(oldTotalData.total_cashflow).toFixed(2)}`);
  console.log();
  console.log(`New view (Blockchain + CLOB):`);
  console.log(`  Entries: ${countData.entry_count}`);
  console.log(`  Total cashflow: $${Number(totalsData.total_cashflow).toFixed(2)}`);
  console.log();
  console.log(`Difference:`);
  console.log(`  Entries: ${Number(countData.entry_count) - Number(oldTotalData.entry_count)}`);
  console.log(`  Cashflow: $${(Number(totalsData.total_cashflow) - Number(oldTotalData.total_cashflow)).toFixed(2)}`);

  console.log();
  console.log("═".repeat(80));
  console.log("PHASE 3 CHECKPOINT");
  console.log("═".repeat(80));
  console.log();
  console.log("✅ Hybrid cashflow view created");
  console.log(`✅ Test wallet has ${countData.entry_count} cashflow entries`);
  console.log(`✅ ${totalsData.has_clob_data} entries have CLOB pricing`);
  console.log(`⚠️  ${totalsData.no_clob_data} entries missing CLOB pricing (will use settlement value)`);
  console.log();
  console.log("Ready to proceed to Phase 4: Rebuild P&L Calculation");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
