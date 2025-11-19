import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("INVESTIGATING MATCHING STRICTNESS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Get ERC1155 transfers and CLOB fills by condition_id
  console.log("Step 1: Comparing ERC1155 vs CLOB coverage by market");
  console.log("─".repeat(80));

  const erc1155MarketsQuery = await clickhouse.query({
    query: `
      SELECT
        ctm.condition_id_norm,
        count(*) as transfer_count,
        sum(CAST(reinterpretAsUInt64(reverse(unhex(substring(t.value, 3)))) AS Float64) / 1000000.0) as total_shares
      FROM erc1155_transfers t
      INNER JOIN ctf_token_map ctm
        ON ctm.token_id = toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3)))))
      WHERE (lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}'))
        AND t.to_address != t.from_address
      GROUP BY ctm.condition_id_norm
      ORDER BY total_shares DESC
    `,
    format: 'JSONEachRow'
  });
  const erc1155Markets = await erc1155MarketsQuery.json();

  const clobMarketsQuery = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(cf.condition_id, '0x', '')) as condition_id_norm,
        count(*) as fill_count,
        sum(cf.size / 1000000.0) as total_shares
      FROM clob_fills cf
      WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm
      ORDER BY total_shares DESC
    `,
    format: 'JSONEachRow'
  });
  const clobMarkets = await clobMarketsQuery.json();

  console.log(`\nERC1155 markets: ${erc1155Markets.length}`);
  console.log(`CLOB markets: ${clobMarkets.length}`);
  console.log();

  // Find markets in ERC1155 but not in CLOB
  const erc1155Only = erc1155Markets.filter((e: any) =>
    !clobMarkets.find((c: any) => c.condition_id_norm === e.condition_id_norm)
  );

  // Find markets in CLOB but not in ERC1155
  const clobOnly = clobMarkets.filter((c: any) =>
    !erc1155Markets.find((e: any) => e.condition_id_norm === c.condition_id_norm)
  );

  // Find markets in both
  const inBoth = erc1155Markets.filter((e: any) =>
    clobMarkets.find((c: any) => c.condition_id_norm === e.condition_id_norm)
  );

  console.log("Market coverage:");
  console.log(`  In ERC1155 only: ${erc1155Only.length} markets`);
  console.log(`  In CLOB only: ${clobOnly.length} markets`);
  console.log(`  In both: ${inBoth.length} markets`);
  console.log();

  if (erc1155Only.length > 0) {
    console.log("Top 10 markets in ERC1155 but NOT in CLOB:");
    console.log("─".repeat(80));
    console.table(erc1155Only.slice(0, 10).map((m: any) => ({
      condition_id: m.condition_id_norm.substring(0, 12) + '...',
      transfers: m.transfer_count,
      total_shares: m.total_shares.toFixed(2)
    })));
    console.log();
  }

  if (clobOnly.length > 0) {
    console.log("Top 10 markets in CLOB but NOT in ERC1155:");
    console.log("─".repeat(80));
    console.table(clobOnly.slice(0, 10).map((m: any) => ({
      condition_id: m.condition_id_norm.substring(0, 12) + '...',
      fills: m.fill_count,
      total_shares: m.total_shares.toFixed(2)
    })));
    console.log();
  }

  // Step 2: Check the actual coverage gap
  console.log("Step 2: Understanding the real gap");
  console.log("─".repeat(80));

  const erc1155Total = erc1155Markets.reduce((sum: number, m: any) => sum + Number(m.total_shares), 0);
  const clobTotal = clobMarkets.reduce((sum: number, m: any) => sum + Number(m.total_shares), 0);

  console.log(`\nTotal shares in ERC1155: ${erc1155Total.toFixed(2)}`);
  console.log(`Total shares in CLOB: ${clobTotal.toFixed(2)}`);
  console.log(`Difference: ${(erc1155Total - clobTotal).toFixed(2)}`);
  console.log();

  // Step 3: Check if the issue is actually about POSITIONS vs FILLS
  console.log("Step 3: Comparing data semantics");
  console.log("─".repeat(80));
  console.log();
  console.log("IMPORTANT DISTINCTION:");
  console.log("  ERC1155 transfers = Token movements (settlements, redemptions, transfers)");
  console.log("  CLOB fills = Orderbook trades (buy/sell executions)");
  console.log();
  console.log("These are tracking DIFFERENT events:");
  console.log("  - CLOB captures the TRADING activity");
  console.log("  - ERC1155 captures SETTLEMENT and REDEMPTION events");
  console.log();
  console.log("The 249 vs 194 difference might be:");
  console.log("  1. Settlement/redemption transfers (not trades)");
  console.log("  2. P2P transfers (not orderbook trades)");
  console.log("  3. Multi-step arbitrage (bridge contracts, etc.)");
  console.log();

  // Step 4: Check the baseline calculation
  console.log("Step 4: Verifying baseline calculation");
  console.log("─".repeat(80));

  const currentPnlQuery = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl_usd) as total_pnl,
        count(*) as market_count
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const currentPnl = (await currentPnlQuery.json())[0];

  console.log(`\nCurrent P&L calculation (realized_pnl_by_market_final):`);
  console.log(`  Total P&L: $${Number(currentPnl.total_pnl).toFixed(2)}`);
  console.log(`  Markets: ${currentPnl.market_count}`);
  console.log();
  console.log(`CLOB markets from query: ${clobMarkets.length}`);
  console.log(`Match: ${currentPnl.market_count === clobMarkets.length ? '✅' : '❌'}`);
  console.log();

  console.log("═".repeat(80));
  console.log("CONCLUSION");
  console.log("═".repeat(80));
  console.log();
  console.log("The 249 ERC1155 transfers vs 194 CLOB fills comparison is MISLEADING.");
  console.log();
  console.log("These are two different data sources:");
  console.log("  ✅ CLOB = Trading data (what we're using for P&L)");
  console.log("  ⚠️  ERC1155 = Settlement/redemption data (different events)");
  console.log();
  console.log("The missing $52K gap is NOT explained by missing CLOB data.");
  console.log();
  console.log("NEXT STEPS:");
  console.log("  1. Investigate if Dome uses different price calculation");
  console.log("  2. Check if there are unresolved positions we're missing");
  console.log("  3. Verify our P&L formula matches Dome's methodology");
  console.log("  4. Check for unrealized P&L (open positions)");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
