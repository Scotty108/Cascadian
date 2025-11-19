#!/usr/bin/env npx tsx
/**
 * DEFINITIVE COVERAGE TEST
 *
 * Three queries, no DDL, no interpretation.
 *
 * A) Gates with fixed denominators (G_abs and G_traded)
 * B) Missing traded CIDs (if G_traded < 95%)
 * C) Wallet coverage sanity check
 *
 * Decision rule:
 * - G_traded ≥ 95%: Ship PnL feature
 * - G_traded < 95%: In-warehouse backfill needed
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('DEFINITIVE COVERAGE TEST');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// QUERY A: Gates with fixed denominators
// ============================================================================

console.log('QUERY A: Gate Measurements (G_abs and G_traded)');
console.log('─'.repeat(80));

try {
  const gateResults = await client.query({
    query: `
      WITH
      RES AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.market_resolutions_final
        WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
      ),
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      TRADED_ANY AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
        UNION ALL
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw_enriched_final
        WHERE condition_id LIKE '0x%'
      )
      SELECT
        (SELECT count() FROM RES)                                                          AS res_cids,
        (SELECT count() FROM FACT)                                                         AS fact_cids,
        (SELECT count() FROM RES  WHERE cid IN (SELECT cid FROM FACT))                     AS overlap_cids,
        round(100.0 * overlap_cids / nullIf((SELECT count() FROM RES),0), 2)               AS G_abs,
        (SELECT count() FROM TRADED_ANY)                                                   AS traded_cids,
        (SELECT count() FROM TRADED_ANY WHERE cid IN (SELECT cid FROM FACT))               AS traded_overlap,
        round(100.0 * traded_overlap / nullIf((SELECT count() FROM TRADED_ANY),0), 2)      AS G_traded
    `,
    format: 'JSONEachRow',
  });

  const gates = await gateResults.json<Array<{
    res_cids: number;
    fact_cids: number;
    overlap_cids: number;
    G_abs: number;
    traded_cids: number;
    traded_overlap: number;
    G_traded: number;
  }>>();

  const gateData = gates[0];

  console.log();
  console.log('Results:');
  console.log(`  RES (resolutions):              ${gateData.res_cids.toLocaleString().padStart(10)} condition IDs`);
  console.log(`  FACT (fact_trades_clean):       ${gateData.fact_cids.toLocaleString().padStart(10)} condition IDs`);
  console.log(`  Overlap (RES ∩ FACT):           ${gateData.overlap_cids.toLocaleString().padStart(10)} condition IDs`);
  console.log(`  G_abs (% resolutions in FACT):  ${gateData.G_abs.toString().padStart(10)}%`);
  console.log();
  console.log(`  TRADED_ANY (warehouse):         ${gateData.traded_cids.toLocaleString().padStart(10)} condition IDs`);
  console.log(`  Traded overlap (TRADED ∩ FACT): ${gateData.traded_overlap.toLocaleString().padStart(10)} condition IDs`);
  console.log(`  G_traded (% traded in FACT):    ${gateData.G_traded.toString().padStart(10)}%`);
  console.log();

  const G_traded = gateData.G_traded;

  console.log('═'.repeat(80));
  console.log('DECISION');
  console.log('═'.repeat(80));
  console.log();

  if (G_traded >= 95) {
    console.log(`✅ G_traded = ${G_traded}% ≥ 95%`);
    console.log();
    console.log('VERDICT: SHIP PnL FEATURE');
    console.log();
    console.log('Rationale:');
    console.log('  • ≥95% of traded condition IDs are in fact_trades_clean');
    console.log('  • Can calculate accurate wallet metrics (win rate, omega, ROI)');
    console.log('  • Missing condition IDs have no trades in warehouse (RES - FACT)');
    console.log();
    console.log('Next steps:');
    console.log('  1. Build wallet PnL views using fact_trades_clean');
    console.log('  2. Join with market_resolutions_final for outcomes');
    console.log('  3. Deploy to production');
    console.log();
  } else {
    console.log(`⚠️  G_traded = ${G_traded}% < 95%`);
    console.log();
    console.log('VERDICT: IN-WAREHOUSE BACKFILL NEEDED');
    console.log();
    console.log('Rationale:');
    console.log(`  • Only ${G_traded}% of traded condition IDs are in fact_trades_clean`);
    console.log(`  • Missing ${(100 - G_traded).toFixed(2)}% of traded markets`);
    console.log('  • Need to recover from existing warehouse tables');
    console.log();
    console.log('Proceeding to QUERY B to identify missing condition IDs...');
    console.log();
  }

  console.log();
  console.log('═'.repeat(80));
  console.log();

  // ========================================================================
  // QUERY B: Missing traded CIDs (only if G_traded < 95)
  // ========================================================================

  if (G_traded < 95) {
    console.log('QUERY B: Missing Traded Condition IDs (Top 200 by Transaction Count)');
    console.log('─'.repeat(80));

    const missingCids = await client.query({
      query: `
        WITH
        FACT AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.fact_trades_clean),
        TRADED_ANY AS (
          SELECT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid, count() AS tx_count
          FROM default.vw_trades_canonical
          WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
          GROUP BY cid
          UNION ALL
          SELECT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid, count()
          FROM default.trades_raw_enriched_final
          WHERE condition_id LIKE '0x%'
          GROUP BY cid
        )
        SELECT cid, sum(tx_count) AS txs
        FROM TRADED_ANY
        WHERE cid NOT IN (SELECT cid FROM FACT)
        GROUP BY cid
        ORDER BY txs DESC
        LIMIT 200
      `,
      format: 'JSONEachRow',
    });

    const missing = await missingCids.json<Array<{ cid: string; txs: string }>>();

    console.log();
    console.log(`Found ${missing.length} missing traded condition IDs (top 200 shown):`);
    console.log();
    console.log('  Condition ID'.padEnd(68) + 'Transactions');
    console.log('  ' + '─'.repeat(78));

    missing.slice(0, 50).forEach((row, i) => {
      console.log(`  ${(i + 1).toString().padStart(3)}. ${row.cid.padEnd(64)} ${row.txs.padStart(8)}`);
    });

    if (missing.length > 50) {
      console.log(`  ... ${missing.length - 50} more condition IDs (omitted for brevity)`);
    }

    const totalMissingTxs = missing.reduce((sum, row) => sum + parseInt(row.txs), 0);
    console.log();
    console.log(`Total transactions on missing condition IDs: ${totalMissingTxs.toLocaleString()}`);
    console.log();

    console.log('Recovery Strategy:');
    console.log('  1. These condition IDs exist in vw_trades_canonical or trades_raw_enriched_final');
    console.log('  2. INSERT INTO fact_trades_clean from these sources with proper normalization');
    console.log('  3. Expected improvement: +' + (100 - G_traded).toFixed(2) + '% coverage');
    console.log();
  }

} catch (error) {
  console.error('❌ QUERY A/B Failed:', error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// QUERY C: Wallet coverage sanity check
// ============================================================================

console.log('QUERY C: Wallet Coverage Sanity Check (Top 6 Wallets)');
console.log('─'.repeat(80));

try {
  const walletCoverage = await client.query({
    query: `
      WITH wallets AS (
        SELECT arrayJoin([
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0x4ce73141dbfce41e65db3723e31059a730f0abad',
          '0x06dcaa14f57d8a0573f5dc5940565e6de667af59',
          '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed',
          '0x7f3c8979d0afa00007bae4747d5347122af05613',
          '0xd06f0f7719df1b3b75b607923536b3250825d4a6'
        ]) AS w
      )
      SELECT 'vw_trades_canonical' AS source, w AS wallet, uniqExact(transaction_hash) AS uniq_tx
      FROM default.vw_trades_canonical JOIN wallets ON wallet_address_norm = w
      GROUP BY source, w
      UNION ALL
      SELECT 'trades_raw_enriched_final', w, uniqExact(transaction_hash)
      FROM default.trades_raw_enriched_final JOIN wallets ON wallet_address = w
      GROUP BY w
      UNION ALL
      SELECT 'trades_raw', w, uniqExact(transaction_hash)
      FROM default.trades_raw JOIN wallets ON wallet_address = w
      GROUP BY w
      UNION ALL
      SELECT 'trade_direction_assignments', w, uniqExact(tx_hash)
      FROM default.trade_direction_assignments JOIN wallets ON wallet_address = w
      GROUP BY w
      ORDER BY wallet, source
    `,
    format: 'JSONEachRow',
  });

  const walletData = await walletCoverage.json<Array<{
    source: string;
    wallet: string;
    uniq_tx: string;
  }>>();

  console.log();
  console.log('Results (unique transactions per wallet per source):');
  console.log();

  // Group by wallet
  const walletMap = new Map<string, Array<{ source: string; uniq_tx: number }>>();
  walletData.forEach(row => {
    if (!walletMap.has(row.wallet)) {
      walletMap.set(row.wallet, []);
    }
    walletMap.get(row.wallet)!.push({
      source: row.source,
      uniq_tx: parseInt(row.uniq_tx)
    });
  });

  // Display by wallet
  let largestGap = { wallet: '', source1: '', source2: '', gap: 0 };

  walletMap.forEach((sources, wallet) => {
    console.log(`  Wallet: ${wallet}`);
    sources.forEach(s => {
      console.log(`    ${s.source.padEnd(30)} ${s.uniq_tx.toLocaleString().padStart(10)} txs`);
    });

    // Find largest gap for this wallet
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const gap = Math.abs(sources[i].uniq_tx - sources[j].uniq_tx);
        if (gap > largestGap.gap) {
          largestGap = {
            wallet,
            source1: sources[i].source,
            source2: sources[j].source,
            gap
          };
        }
      }
    }

    console.log();
  });

  if (largestGap.gap > 0) {
    console.log('Largest Gap:');
    console.log(`  Wallet: ${largestGap.wallet}`);
    console.log(`  Between: ${largestGap.source1} and ${largestGap.source2}`);
    console.log(`  Gap: ${largestGap.gap.toLocaleString()} transactions`);
    console.log();
    console.log('Recommendation:');
    console.log(`  Investigate difference between ${largestGap.source1} and ${largestGap.source2}`);
    console.log('  Use table with higher coverage as backfill source');
    console.log();
  }

} catch (error) {
  console.error('❌ QUERY C Failed:', error);
}

console.log('═'.repeat(80));
console.log('END OF DEFINITIVE COVERAGE TEST');
console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
