import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log("═".repeat(80));
  console.log("OPTION B: IDENTIFY MISSING CLOB FILLS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Get all ERC1155 transfers for test wallet
  console.log("Step 1: Getting ERC1155 transfers for test wallet...");
  console.log("─".repeat(80));

  const erc1155Query = await clickhouse.query({
    query: `
      SELECT
        t.tx_hash,
        t.block_number,
        t.block_timestamp,
        t.to_address,
        t.from_address,
        t.token_id,
        toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3))))) AS token_id_decimal,
        CAST(reinterpretAsUInt64(reverse(unhex(substring(t.value, 3)))) AS Float64) / 1000000.0 AS shares,
        ctm.condition_id_norm,
        ctm.outcome_index
      FROM erc1155_transfers t
      LEFT JOIN ctf_token_map ctm
        ON ctm.token_id = toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3)))))
      WHERE (lower(t.to_address) = lower('${testWallet}')
         OR lower(t.from_address) = lower('${testWallet}'))
        AND t.to_address != t.from_address
      ORDER BY t.block_timestamp
    `,
    format: 'JSONEachRow'
  });
  const erc1155Data = await erc1155Query.json();

  console.log(`✅ Found ${erc1155Data.length} ERC1155 transfers`);
  console.log();

  // Step 2: Get all CLOB fills for test wallet
  console.log("Step 2: Getting CLOB fills for test wallet...");
  console.log("─".repeat(80));

  const clobQuery = await clickhouse.query({
    query: `
      SELECT
        cf.tx_hash,
        cf.timestamp,
        lower(cf.proxy_wallet) AS wallet,
        cf.asset_id,
        cf.side,
        cf.size / 1000000.0 AS shares,
        ctm.condition_id_norm,
        ctm.outcome_index
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm
        ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
      ORDER BY cf.timestamp
    `,
    format: 'JSONEachRow'
  });
  const clobData = await clobQuery.json();

  console.log(`✅ Found ${clobData.length} CLOB fills`);
  console.log();

  // Step 3: Find missing fills
  console.log("Step 3: Identifying missing CLOB fills...");
  console.log("─".repeat(80));

  // Create lookup map of CLOB fills by condition_id + outcome_index + approximate timestamp
  const clobMap = new Map<string, any>();
  for (const fill of clobData) {
    const key = `${fill.condition_id_norm}-${fill.outcome_index}`;
    if (!clobMap.has(key)) {
      clobMap.set(key, []);
    }
    clobMap.get(key)!.push(fill);
  }

  // Find ERC1155 transfers with no matching CLOB fill
  const missingFills: any[] = [];
  const matchedTransfers: any[] = [];

  for (const transfer of erc1155Data) {
    if (!transfer.condition_id_norm) {
      // Skip transfers we can't map to condition_id
      continue;
    }

    const key = `${transfer.condition_id_norm}-${transfer.outcome_index}`;
    const potentialMatches = clobMap.get(key) || [];

    // Try to match by timestamp (within 5 minutes) and share amount (within 1%)
    const blockTs = new Date(transfer.block_timestamp).getTime();
    const matched = potentialMatches.find((fill: any) => {
      const fillTs = new Date(fill.timestamp).getTime();
      const timeDiff = Math.abs(blockTs - fillTs);
      const shareDiff = Math.abs(transfer.shares - fill.shares);
      const sharePercent = transfer.shares > 0 ? shareDiff / transfer.shares : 0;

      return timeDiff < 5 * 60 * 1000 && sharePercent < 0.01; // 5 min, 1% tolerance
    });

    if (!matched) {
      missingFills.push({
        tx_hash: transfer.tx_hash,
        block_number: transfer.block_number,
        block_timestamp: transfer.block_timestamp,
        direction: transfer.to_address.toLowerCase() === testWallet.toLowerCase() ? 'BUY' : 'SELL',
        shares: transfer.shares,
        condition_id: transfer.condition_id_norm,
        outcome_index: transfer.outcome_index,
        token_id_hex: transfer.token_id,
        token_id_decimal: transfer.token_id_decimal
      });
    } else {
      matchedTransfers.push(transfer);
    }
  }

  console.log(`✅ Analysis complete:`);
  console.log(`   Total ERC1155 transfers: ${erc1155Data.length}`);
  console.log(`   Matched to CLOB fills: ${matchedTransfers.length}`);
  console.log(`   Missing from CLOB: ${missingFills.length}`);
  console.log();

  // Step 4: Analyze missing fills
  console.log("Step 4: Analyzing missing fills...");
  console.log("─".repeat(80));

  // Group by condition_id
  const byCondition = new Map<string, any[]>();
  for (const fill of missingFills) {
    if (!fill.condition_id) continue;
    if (!byCondition.has(fill.condition_id)) {
      byCondition.set(fill.condition_id, []);
    }
    byCondition.get(fill.condition_id)!.push(fill);
  }

  console.log(`\nMissing fills grouped by market:`);
  console.log(`  Unique markets missing: ${byCondition.size}`);
  console.log();

  // Show top 10 missing fills by share size
  console.log("Top 10 missing fills by share size:");
  console.log("─".repeat(80));

  const sorted = [...missingFills]
    .filter(f => f.condition_id)
    .sort((a, b) => Math.abs(b.shares) - Math.abs(a.shares))
    .slice(0, 10);

  console.table(sorted.map(f => ({
    block: f.block_number,
    timestamp: f.block_timestamp,
    direction: f.direction,
    shares: f.shares.toFixed(2),
    condition_id: f.condition_id?.substring(0, 12) + '...',
    outcome_idx: f.outcome_index
  })));

  // Step 5: Save missing fills to file
  console.log("\nStep 5: Saving missing fills to file...");
  console.log("─".repeat(80));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `tmp/missing_clob_fills_${timestamp}.json`;

  writeFileSync(filename, JSON.stringify({
    summary: {
      total_erc1155_transfers: erc1155Data.length,
      matched_to_clob: matchedTransfers.length,
      missing_from_clob: missingFills.length,
      unique_markets_missing: byCondition.size,
      generated_at: new Date().toISOString(),
      test_wallet: testWallet
    },
    missing_fills: missingFills,
    by_condition_id: Object.fromEntries(byCondition)
  }, null, 2));

  console.log(`✅ Saved to ${filename}`);
  console.log();

  // Step 6: Check if missing markets exist in gamma_markets
  console.log("Step 6: Checking if missing markets exist in gamma_markets...");
  console.log("─".repeat(80));

  const uniqueConditions = Array.from(byCondition.keys()).filter(c => c);

  if (uniqueConditions.length > 0) {
    const marketCheckQuery = await clickhouse.query({
      query: `
        SELECT
          lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
          question,
          market_slug
        FROM gamma_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) IN (${uniqueConditions.map(c => `'${c}'`).join(',')})
      `,
      format: 'JSONEachRow'
    });
    const marketData = await marketCheckQuery.json();

    console.log(`\nMarket lookup results:`);
    console.log(`  Markets in gamma_markets: ${marketData.length}/${uniqueConditions.length}`);

    if (marketData.length > 0) {
      console.log(`\nSample markets found:`);
      console.table(marketData.slice(0, 5).map((m: any) => ({
        condition_id: m.condition_id_norm.substring(0, 12) + '...',
        question: m.question?.substring(0, 50) + '...'
      })));
    }

    const missingMarkets = uniqueConditions.filter(c =>
      !marketData.find((m: any) => m.condition_id_norm === c)
    );

    if (missingMarkets.length > 0) {
      console.log(`\n⚠️  ${missingMarkets.length} condition_ids NOT in gamma_markets:`);
      missingMarkets.slice(0, 5).forEach(c => {
        console.log(`   - ${c}`);
      });
    }
  }

  console.log();
  console.log("═".repeat(80));
  console.log("MISSING FILLS IDENTIFICATION COMPLETE");
  console.log("═".repeat(80));
  console.log();
  console.log(`📊 Summary:`);
  console.log(`   Total ERC1155 transfers: ${erc1155Data.length}`);
  console.log(`   Matched to CLOB: ${matchedTransfers.length}`);
  console.log(`   Missing from CLOB: ${missingFills.length}`);
  console.log(`   Unique markets affected: ${byCondition.size}`);
  console.log();
  console.log(`📁 Details saved to: ${filename}`);
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
