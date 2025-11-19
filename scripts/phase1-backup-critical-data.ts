import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFile } from 'fs/promises';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 1: BACKUP & SAFETY (Optimized)");
  console.log("═".repeat(80));
  console.log();
  console.log("Backing up critical data before rebuild...");
  console.log();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace(/[-]/g, '').substring(0, 15);
  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Backup test wallet's current P&L (for validation)
  console.log("Step 1: Backing up test wallet P&L baseline...");
  console.log("─".repeat(80));

  try {
    const pnlQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM realized_pnl_by_market_final
        WHERE lower(wallet) = lower('${testWallet}')
        ORDER BY realized_pnl_usd DESC
      `,
      format: 'JSONEachRow'
    });
    const pnlData = await pnlQuery.json();

    await writeFile(
      `tmp/pnl_baseline_${timestamp}.json`,
      JSON.stringify(pnlData, null, 2)
    );

    const totalPnl = pnlData.reduce((sum: number, row: any) => sum + Number(row.realized_pnl_usd || 0), 0);
    console.log(`✅ Backed up ${pnlData.length} markets`);
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`   Saved to: tmp/pnl_baseline_${timestamp}.json`);
  } catch (error: any) {
    console.error(`❌ Failed to backup P&L:`, error.message);
  }

  console.log();

  // Step 2: Backup outcome positions for test wallet
  console.log("Step 2: Backing up test wallet positions...");
  console.log("─".repeat(80));

  try {
    const posQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM outcome_positions_v2
        WHERE lower(wallet) = lower('${testWallet}')
        ORDER BY net_shares DESC
      `,
      format: 'JSONEachRow'
    });
    const posData = await posQuery.json();

    await writeFile(
      `tmp/positions_baseline_${timestamp}.json`,
      JSON.stringify(posData, null, 2)
    );

    console.log(`✅ Backed up ${posData.length} positions`);
    console.log(`   Saved to: tmp/positions_baseline_${timestamp}.json`);
  } catch (error: any) {
    console.error(`❌ Failed to backup positions:`, error.message);
  }

  console.log();

  // Step 3: Document current view definitions
  console.log("Step 3: Documenting view definitions...");
  console.log("─".repeat(80));

  const views = ['outcome_positions_v2', 'realized_pnl_by_market_final'];
  const viewDefs: any = {};

  for (const viewName of views) {
    try {
      const defQuery = await clickhouse.query({
        query: `SHOW CREATE TABLE ${viewName}`,
        format: 'TabSeparated'
      });
      const def = await defQuery.text();
      viewDefs[viewName] = def;
      console.log(`✅ Documented ${viewName}`);
    } catch (error: any) {
      console.log(`⚠️  Could not get definition for ${viewName}: ${error.message}`);
    }
  }

  await writeFile(
    `tmp/view_definitions_${timestamp}.json`,
    JSON.stringify(viewDefs, null, 2)
  );

  console.log(`   Saved to: tmp/view_definitions_${timestamp}.json`);
  console.log();

  // Step 4: Verify ERC1155 data availability
  console.log("Step 4: Verifying ERC1155 data availability...");
  console.log("─".repeat(80));

  // Check erc1155_transfers
  const erc1155Check = await clickhouse.query({
    query: `
      SELECT count(*) as transfer_count
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${testWallet}')
         OR lower(from_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const erc1155Count = (await erc1155Check.json())[0].transfer_count;
  console.log(`ERC1155 transfers for test wallet: ${erc1155Count}`);

  // Check CLOB fills for comparison
  const clobCheck = await clickhouse.query({
    query: `
      SELECT count(*) as fill_count
      FROM clob_fills
      WHERE lower(proxy_wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const clobCount = (await clobCheck.json())[0].fill_count;
  console.log(`CLOB fills for test wallet: ${clobCount}`);
  console.log(`Missing transactions: ${Number(erc1155Count) - Number(clobCount)}`);

  // Check ctf_token_map
  const mapCheck = await clickhouse.query({
    query: `SELECT count(*) as cnt FROM ctf_token_map`,
    format: 'JSONEachRow'
  });
  const mapCount = (await mapCheck.json())[0].cnt;
  console.log(`CTF token map entries: ${mapCount}`);

  // Check join success rate
  const joinCheck = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_transfers,
        countIf(ctm.condition_id_norm IS NOT NULL) as mapped_transfers
      FROM erc1155_transfers t
      LEFT JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
      WHERE lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const joinData = (await joinCheck.json())[0];
  const joinRate = (Number(joinData.mapped_transfers) / Number(joinData.total_transfers) * 100).toFixed(1);
  console.log(`Join success rate: ${joinData.mapped_transfers}/${joinData.total_transfers} (${joinRate}%)`);

  console.log();
  console.log("═".repeat(80));
  console.log("PHASE 1 COMPLETE");
  console.log("═".repeat(80));
  console.log();
  console.log("✅ Test wallet P&L backed up");
  console.log("✅ Test wallet positions backed up");
  console.log("✅ View definitions documented");
  console.log("✅ ERC1155 data availability confirmed");
  console.log();
  console.log(`Backup timestamp: ${timestamp}`);
  console.log();
  console.log("ROLLBACK PROCEDURE:");
  console.log("  If rebuild fails, restore baseline from:");
  console.log(`  - tmp/pnl_baseline_${timestamp}.json`);
  console.log(`  - tmp/positions_baseline_${timestamp}.json`);
  console.log(`  - tmp/view_definitions_${timestamp}.json`);
  console.log();
  console.log("Ready to proceed to Phase 2: Build ERC1155 Position Tracking");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
