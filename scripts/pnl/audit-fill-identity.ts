#!/usr/bin/env npx tsx
/**
 * Audit Fill Identity and Duplication Patterns
 *
 * Investigates whether the 2x PnL bug is caused by:
 * 1. True duplicate fills (same fill appearing multiple times)
 * 2. Maker+Taker double-counting (same economic event from both perspectives)
 * 3. Insufficient deduplication (wrong dedupe key)
 *
 * Tests 5 wallets with known PnL mismatches against UI:
 * - 0x35f0a66e8a0ddcb49cb93213b21642bdd854b776: V18 +3813.99 vs UI +3291.63
 * - 0x34393448709dd71742f4a8f0973955cf59b4f64: V18 -8259.78 vs UI 0.00
 * - 0x227c55d09ff49d420fc741c5e301904af62fa303: V18 +184.09 vs UI -278.07
 * - 0x222adc4302f58fe679f5212cf11344d29c0d103c: V18 0.00 vs UI +520.00
 * - 0x0e5f632cdfb0f5a22d22331fd81246f452dccf38: V18 -1.00 vs UI -399.79
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

interface TestWallet {
  address: string;
  v18_pnl: number;
  ui_pnl: number;
}

const TEST_WALLETS: TestWallet[] = [
  {
    address: '0x35f0a66e8a0ddcb49cb93213b21642bdd854b776',
    v18_pnl: 3813.99,
    ui_pnl: 3291.63,
  },
  {
    address: '0x34393448709dd71742f4a8f0973955cf59b4f64',
    v18_pnl: -8259.78,
    ui_pnl: 0.0,
  },
  {
    address: '0x227c55d09ff49d420fc741c5e301904af62fa303',
    v18_pnl: 184.09,
    ui_pnl: -278.07,
  },
  {
    address: '0x222adc4302f58fe679f5212cf11344d29c0d103c',
    v18_pnl: 0.0,
    ui_pnl: 520.0,
  },
  {
    address: '0x0e5f632cdfb0f5a22d22331fd81246f452dccf38',
    v18_pnl: -1.0,
    ui_pnl: -399.79,
  },
];

interface DuplicationStats {
  wallet: string;
  total_rows: number;
  unique_event_ids: number;
  unique_tx_hash_log_pairs: number;
  unique_economic_fills: number;
  event_id_duplicates: number;
  tx_hash_log_duplicates: number;
  economic_duplicates: number;
  maker_fills: number;
  taker_fills: number;
  same_wallet_maker_taker_pairs: number;
}

interface FillExample {
  event_id: string;
  transaction_hash: string;
  role: string;
  side: string;
  token_amount: number;
  usdc_amount: number;
  trade_time: string;
}

async function auditWallet(wallet: TestWallet): Promise<DuplicationStats> {
  const addr = wallet.address.toLowerCase();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`AUDITING: ${addr}`);
  console.log(`V18 PnL: $${wallet.v18_pnl.toFixed(2)} | UI PnL: $${wallet.ui_pnl.toFixed(2)}`);
  console.log(`Ratio: ${wallet.v18_pnl !== 0 ? (wallet.v18_pnl / wallet.ui_pnl).toFixed(2) + 'x' : 'N/A'}`);
  console.log(`${'='.repeat(80)}`);

  // 1. Count total rows
  const totalQuery = `
    SELECT count() as cnt
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = '${addr}'
  `;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = (await totalResult.json()) as any[];
  const total_rows = Number(totalData[0].cnt);

  // 2. Count unique event_ids
  const eventIdQuery = `
    SELECT uniqExact(event_id) as cnt
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = '${addr}'
  `;
  const eventIdResult = await clickhouse.query({ query: eventIdQuery, format: 'JSONEachRow' });
  const eventIdData = (await eventIdResult.json()) as any[];
  const unique_event_ids = Number(eventIdData[0].cnt);

  // 3. Count unique transaction_hash values
  const txHashQuery = `
    SELECT uniqExact(transaction_hash) as cnt
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = '${addr}'
  `;
  const txHashResult = await clickhouse.query({ query: txHashQuery, format: 'JSONEachRow' });
  const txHashData = (await txHashResult.json()) as any[];
  const unique_tx_hash_log_pairs = Number(txHashData[0].cnt);

  // 4. Count unique "economic fills" (transaction_hash + token_id + amounts)
  const economicQuery = `
    SELECT uniqExact(concat(
      transaction_hash, '-',
      token_id, '-',
      toString(token_amount), '-',
      toString(usdc_amount)
    )) as cnt
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = '${addr}'
  `;
  const economicResult = await clickhouse.query({ query: economicQuery, format: 'JSONEachRow' });
  const economicData = (await economicResult.json()) as any[];
  const unique_economic_fills = Number(economicData[0].cnt);

  // 5. Count maker vs taker fills
  const roleQuery = `
    SELECT
      countIf(lower(role) = 'maker') as maker_cnt,
      countIf(lower(role) = 'taker') as taker_cnt
    FROM (
      SELECT any(role) as role
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = '${addr}'
      GROUP BY event_id
    )
  `;
  const roleResult = await clickhouse.query({ query: roleQuery, format: 'JSONEachRow' });
  const roleData = (await roleResult.json()) as any[];
  const maker_fills = Number(roleData[0].maker_cnt);
  const taker_fills = Number(roleData[0].taker_cnt);

  // 6. Check for fills where same (transaction_hash, token_id, amount) appears as both maker AND taker for THIS wallet
  const makerTakerQuery = `
    SELECT count() as cnt
    FROM (
      SELECT
        transaction_hash,
        token_id,
        token_amount,
        usdc_amount,
        groupArray(distinct role) as roles
      FROM (
        SELECT
          any(transaction_hash) as transaction_hash,
          any(token_id) as token_id,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount,
          any(role) as role
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = '${addr}'
        GROUP BY event_id
      )
      GROUP BY transaction_hash, token_id, token_amount, usdc_amount
      HAVING length(roles) > 1
    )
  `;
  const makerTakerResult = await clickhouse.query({ query: makerTakerQuery, format: 'JSONEachRow' });
  const makerTakerData = (await makerTakerResult.json()) as any[];
  const same_wallet_maker_taker_pairs = Number(makerTakerData[0].cnt);

  // 7. Show examples of duplicates if they exist
  const event_id_duplicates = total_rows - unique_event_ids;
  const tx_hash_log_duplicates = total_rows - unique_tx_hash_log_pairs;
  const economic_duplicates = total_rows - unique_economic_fills;

  console.log(`\nDUPLICATION ANALYSIS:`);
  console.log(`  Total rows: ${total_rows}`);
  console.log(`  Unique event_ids: ${unique_event_ids} (${event_id_duplicates} duplicates, ${((event_id_duplicates / total_rows) * 100).toFixed(1)}%)`);
  console.log(`  Unique transaction_hash: ${unique_tx_hash_log_pairs} (${tx_hash_log_duplicates} duplicates, ${((tx_hash_log_duplicates / total_rows) * 100).toFixed(1)}%)`);
  console.log(`  Unique economic fills: ${unique_economic_fills} (${economic_duplicates} duplicates, ${((economic_duplicates / total_rows) * 100).toFixed(1)}%)`);
  console.log(`\nROLE DISTRIBUTION (after event_id dedupe):`);
  console.log(`  Maker fills: ${maker_fills}`);
  console.log(`  Taker fills: ${taker_fills}`);
  console.log(`  Same-wallet maker+taker pairs: ${same_wallet_maker_taker_pairs}`);

  if (event_id_duplicates > 0) {
    console.log(`\n⚠️ event_id DUPLICATES FOUND - Examples:`);
    const exampleQuery = `
      SELECT event_id, count() as cnt
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = '${addr}'
      GROUP BY event_id
      HAVING cnt > 1
      LIMIT 3
    `;
    const exampleResult = await clickhouse.query({ query: exampleQuery, format: 'JSONEachRow' });
    const examples = (await exampleResult.json()) as any[];
    for (const ex of examples) {
      console.log(`  ${ex.event_id.slice(0, 20)}... appears ${ex.cnt} times`);

      // Show details of each occurrence
      const detailQuery = `
        SELECT
          transaction_hash,
          role,
          side,
          token_amount / 1e6 as tokens,
          usdc_amount / 1e6 as usdc,
          trade_time
        FROM pm_trader_events_dedup_v2_tbl
        WHERE event_id = '${ex.event_id}'
        AND lower(trader_wallet) = '${addr}'
      `;
      const detailResult = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
      const details = (await detailResult.json()) as any[];
      for (const d of details) {
        console.log(`    tx=${d.transaction_hash.slice(0, 10)}... role=${d.role} side=${d.side} tokens=${Number(d.tokens).toFixed(2)} usdc=$${Number(d.usdc).toFixed(2)} time=${d.trade_time}`);
      }
    }
  }

  if (same_wallet_maker_taker_pairs > 0) {
    console.log(`\n⚠️ MAKER+TAKER PAIRS FOUND (same economic fill, both roles) - Examples:`);
    const pairQuery = `
      SELECT
        transaction_hash,
        token_id,
        token_amount / 1e6 as tokens,
        usdc_amount / 1e6 as usdc,
        groupArray(distinct role) as roles,
        count() as event_count
      FROM (
        SELECT
          any(transaction_hash) as transaction_hash,
          any(token_id) as token_id,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount,
          any(role) as role,
          event_id
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = '${addr}'
        GROUP BY event_id
      )
      GROUP BY transaction_hash, token_id, token_amount, usdc_amount
      HAVING length(roles) > 1
      LIMIT 3
    `;
    const pairResult = await clickhouse.query({ query: pairQuery, format: 'JSONEachRow' });
    const pairs = (await pairResult.json()) as any[];
    for (const p of pairs) {
      console.log(`  tx=${p.transaction_hash.slice(0, 10)}... tokens=${Number(p.tokens).toFixed(2)} usdc=$${Number(p.usdc).toFixed(2)}`);
      console.log(`    roles=${p.roles.join(', ')} (${p.event_count} event_ids)`);
    }
  }

  return {
    wallet: addr,
    total_rows,
    unique_event_ids,
    unique_tx_hash_log_pairs,
    unique_economic_fills,
    event_id_duplicates,
    tx_hash_log_duplicates,
    economic_duplicates,
    maker_fills,
    taker_fills,
    same_wallet_maker_taker_pairs,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('FILL IDENTITY AND DUPLICATION AUDIT');
  console.log('='.repeat(80));
  console.log(`Testing ${TEST_WALLETS.length} wallets with known PnL mismatches`);

  const results: DuplicationStats[] = [];

  for (const wallet of TEST_WALLETS) {
    const stats = await auditWallet(wallet);
    results.push(stats);
  }

  // Generate markdown report
  console.log(`\n${'='.repeat(80)}`);
  console.log('GENERATING REPORT');
  console.log('='.repeat(80));

  const reportLines: string[] = [];
  reportLines.push('# Fill Duplication Audit Report\n');
  reportLines.push('**Generated:** ' + new Date().toISOString() + '\n');
  reportLines.push('## Executive Summary\n');

  const totalWallets = results.length;
  const walletsWithEventIdDupes = results.filter(r => r.event_id_duplicates > 0).length;
  const walletsWithMakerTakerPairs = results.filter(r => r.same_wallet_maker_taker_pairs > 0).length;

  const walletsWithZeroRows = results.filter(r => r.total_rows === 0).length;
  reportLines.push(`- **Wallets tested:** ${totalWallets}`);
  if (walletsWithZeroRows > 0) {
    reportLines.push(`- **Wallets with 0 rows (excluded from averages):** ${walletsWithZeroRows}`);
  }
  reportLines.push(`- **Wallets with event_id duplicates:** ${walletsWithEventIdDupes} (${((walletsWithEventIdDupes / totalWallets) * 100).toFixed(0)}%)`);
  reportLines.push(`- **Wallets with maker+taker pairs:** ${walletsWithMakerTakerPairs} (${((walletsWithMakerTakerPairs / totalWallets) * 100).toFixed(0)}%)\n`);

  reportLines.push('## Key Findings\n');

  // Filter out wallets with 0 rows to avoid NaN
  const walletsWithData = results.filter(r => r.total_rows > 0);
  const avgEventIdDupePct =
    walletsWithData.reduce((sum, r) => sum + (r.event_id_duplicates / r.total_rows) * 100, 0) / walletsWithData.length;
  const avgTxHashLogDupePct =
    walletsWithData.reduce((sum, r) => sum + (r.tx_hash_log_duplicates / r.total_rows) * 100, 0) / walletsWithData.length;
  const avgEconomicDupePct =
    walletsWithData.reduce((sum, r) => sum + (r.economic_duplicates / r.total_rows) * 100, 0) / walletsWithData.length;

  reportLines.push(`### Duplication Rates (Average Across Wallets)\n`);
  reportLines.push(`- **event_id duplicates:** ${avgEventIdDupePct.toFixed(1)}%`);
  reportLines.push(`- **transaction_hash duplicates:** ${avgTxHashLogDupePct.toFixed(1)}%`);
  reportLines.push(`- **Economic fill duplicates:** ${avgEconomicDupePct.toFixed(1)}%\n`);

  reportLines.push('### Recommended Deduplication Strategy\n');

  if (avgEventIdDupePct < 1.0 && avgTxHashLogDupePct < 1.0) {
    reportLines.push('**Recommendation:** `event_id` is sufficient as primary dedupe key.\n');
    reportLines.push('- Current GROUP BY event_id pattern is correct');
    reportLines.push('- Very low duplication rate suggests table is well-maintained\n');
  } else if (avgEventIdDupePct > 5.0) {
    reportLines.push('**Recommendation:** Switch to `transaction_hash` as dedupe key.\n');
    reportLines.push('- High event_id duplication suggests unreliable event_id generation');
    reportLines.push('- transaction_hash is blockchain-canonical\n');
  } else {
    reportLines.push('**Recommendation:** Use composite key: `(transaction_hash, token_id, token_amount, usdc_amount)`\n');
    reportLines.push('- Captures true economic identity of fill');
    reportLines.push('- Handles edge cases where same event appears with different metadata\n');
  }

  reportLines.push('### Maker-Only vs Full Deduplication\n');

  if (walletsWithMakerTakerPairs > totalWallets * 0.5) {
    reportLines.push(
      '**Conclusion:** "Maker-only" filtering is a **HACK** that masks the real problem.\n'
    );
    reportLines.push(`- ${walletsWithMakerTakerPairs}/${totalWallets} wallets have maker+taker pairs`);
    reportLines.push(
      '- This suggests the same fill is being recorded twice with different roles'
    );
    reportLines.push('- **Root cause:** Insufficient deduplication, not intentional dual-perspective recording');
    reportLines.push(
      '- **Proper fix:** Deduplicate by economic fill identity (transaction_hash + amounts)\n'
    );
  } else {
    reportLines.push('**Conclusion:** Maker+taker pairs are rare.\n');
    reportLines.push(`- Only ${walletsWithMakerTakerPairs}/${totalWallets} wallets affected`);
    reportLines.push(
      '- "Maker-only" filtering may be sufficient as a tactical fix'
    );
    reportLines.push(
      '- However, proper deduplication by event_id or transaction_hash is still recommended\n'
    );
  }

  reportLines.push('## Detailed Results\n');
  reportLines.push('| Wallet | Total Rows | event_id Dupes | tx+log Dupes | Econ Dupes | Maker/Taker | M+T Pairs |');
  reportLines.push('|--------|------------|----------------|--------------|------------|-------------|-----------|');

  for (const r of results) {
    const eventIdDupePct = ((r.event_id_duplicates / r.total_rows) * 100).toFixed(1);
    const txLogDupePct = ((r.tx_hash_log_duplicates / r.total_rows) * 100).toFixed(1);
    const econDupePct = ((r.economic_duplicates / r.total_rows) * 100).toFixed(1);
    reportLines.push(
      `| ${r.wallet.slice(0, 10)}... | ${r.total_rows} | ${r.event_id_duplicates} (${eventIdDupePct}%) | ${r.tx_hash_log_duplicates} (${txLogDupePct}%) | ${r.economic_duplicates} (${econDupePct}%) | ${r.maker_fills}/${r.taker_fills} | ${r.same_wallet_maker_taker_pairs} |`
    );
  }

  reportLines.push('\n## Next Steps\n');
  reportLines.push('1. **Review duplication examples** in console output above');
  reportLines.push(
    '2. **Verify deduplication strategy** - test recommended approach on one wallet'
  );
  reportLines.push(
    '3. **Update PnL engine** to use correct dedupe key (if needed)'
  );
  reportLines.push('4. **Re-run UI spot check** on failing wallets with new approach');
  reportLines.push('5. **Document findings** in PnL system guide\n');

  const reportPath = '/Users/scotty/Projects/Cascadian-app/docs/reports/FILL_DUPLICATION_AUDIT.md';
  fs.writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\nReport written to: ${reportPath}`);

  await clickhouse.close();
}

main().catch(console.error);
