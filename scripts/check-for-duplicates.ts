import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("CHECKING FOR DUPLICATES IN VIEWS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Check for duplicates in outcome_positions_v2_blockchain
  console.log("1. Checking outcome_positions_v2_blockchain for duplicates");
  console.log("─".repeat(80));

  const positionDupsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        count(*) as dup_count,
        groupArray(net_shares) as share_values
      FROM outcome_positions_v2_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm, outcome_idx
      HAVING count(*) > 1
      ORDER BY dup_count DESC
    `,
    format: 'JSONEachRow'
  });
  const positionDups = await positionDupsQuery.json();

  if (positionDups.length > 0) {
    console.log(`\n❌ Found ${positionDups.length} duplicate position groups:`);
    console.table(positionDups.map((d: any) => ({
      cid: d.condition_id_norm.substring(0, 12) + '...',
      outcome_idx: d.outcome_idx,
      dup_count: d.dup_count,
      values: JSON.stringify(d.share_values)
    })));
  } else {
    console.log("\n✅ No duplicates in outcome_positions_v2_blockchain");
  }

  // Check total unique positions
  const uniquePositionsQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT condition_id_norm, outcome_idx) as unique_positions
      FROM outcome_positions_v2_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const uniqueData = (await uniquePositionsQuery.json())[0];
  console.log(`\nTotal rows: ${uniqueData.total_rows}`);
  console.log(`Unique (condition_id, outcome_idx) pairs: ${uniqueData.unique_positions}`);

  // Check for duplicates in trade_cashflows_v3_blockchain
  console.log("\n2. Checking trade_cashflows_v3_blockchain for duplicates");
  console.log("─".repeat(80));

  const cashflowDupsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        count(*) as dup_count,
        groupArray(net_shares) as share_values,
        groupArray(cashflow) as cashflow_values
      FROM trade_cashflows_v3_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm, outcome_idx
      HAVING count(*) > 1
      ORDER BY dup_count DESC
    `,
    format: 'JSONEachRow'
  });
  const cashflowDups = await cashflowDupsQuery.json();

  if (cashflowDups.length > 0) {
    console.log(`\n❌ Found ${cashflowDups.length} duplicate cashflow groups:`);
    console.table(cashflowDups.slice(0, 10).map((d: any) => ({
      cid: d.condition_id_norm.substring(0, 12) + '...',
      outcome_idx: d.outcome_idx,
      dup_count: d.dup_count,
      shares: JSON.stringify(d.share_values),
      cashflows: JSON.stringify(d.cashflow_values)
    })));
  } else {
    console.log("\n✅ No duplicates in trade_cashflows_v3_blockchain");
  }

  // Check realized_pnl_by_market_blockchain duplicates
  console.log("\n3. Checking realized_pnl_by_market_blockchain for duplicates");
  console.log("─".repeat(80));

  const pnlDupsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        count(*) as dup_count,
        groupArray(realized_pnl_usd) as pnl_values
      FROM realized_pnl_by_market_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm, outcome_idx
      HAVING count(*) > 1
      ORDER BY dup_count DESC
    `,
    format: 'JSONEachRow'
  });
  const pnlDups = await pnlDupsQuery.json();

  if (pnlDups.length > 0) {
    console.log(`\n❌ Found ${pnlDups.length} duplicate P&L groups:`);
    console.table(pnlDups.slice(0, 10).map((d: any) => ({
      cid: d.condition_id_norm.substring(0, 12) + '...',
      outcome_idx: d.outcome_idx,
      dup_count: d.dup_count,
      pnl_values: JSON.stringify(d.pnl_values)
    })));

    // Calculate duplicate impact on P&L
    const dupImpactQuery = await clickhouse.query({
      query: `
        WITH dup_markets AS (
          SELECT
            condition_id_norm,
            outcome_idx,
            count(*) as dup_count,
            any(realized_pnl_usd) as pnl_value
          FROM realized_pnl_by_market_blockchain
          WHERE lower(wallet) = lower('${testWallet}')
          GROUP BY condition_id_norm, outcome_idx
          HAVING count(*) > 1
        )
        SELECT
          sum(pnl_value * (dup_count - 1)) as duplicate_pnl_inflation
        FROM dup_markets
      `,
      format: 'JSONEachRow'
    });
    const dupImpact = (await dupImpactQuery.json())[0];
    console.log(`\n⚠️  Duplicate P&L inflation: $${Number(dupImpact.duplicate_pnl_inflation).toFixed(2)}`);
    console.log(`   This is being counted multiple times in the current total!`);
  } else {
    console.log("\n✅ No duplicates in realized_pnl_by_market_blockchain");
  }

  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
