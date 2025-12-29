/**
 * Analyze Unified Ledger Source Types
 *
 * Maps out what each source_type in pm_unified_ledger_v5 represents
 * to help define V19 inclusion rules.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

// Wallets to analyze in detail
const DETAILED_WALLETS = [
  // Worst performers (high error)
  '0x6a8ab02581be2c9ba3cdb59eeba25a481ee38a70', // Johnny - 113% error
  '0x8d74bc5d0da9eb1c16cc21648bc2e5c3b0b63b76', // 125% error
  '0x3355c7a6c069ddd39b23f92ab78b7f8c3636a62', // 56% error
  '0xf76fadc02593ae36efbc0d22eb8fece6af0093c7', // Menti2-9 - 17% error
  // Best performers (low error)
  '0x62fadaf110588be0d8fcf2c711bae31051bb50a9', // Anon12345678910 - 0%
  '0x5644c423a2cc35e71f2e7d4efb7a5c3b7e1c4c6a', // hulumulu - 0%
  '0x1faa3465ce8b31542e8fe91282b2b54ce2a98fe6', // Bl4cksparrow - 0%
  '0x3823807e31ab8f2c4d8b7c4f5e3a2d1b0c9e8f7a', // moneyfet1sh - 0%
];

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

async function main() {
  console.log('='.repeat(100));
  console.log('UNIFIED LEDGER SOURCE TYPE ANALYSIS');
  console.log('='.repeat(100));

  // 1. Quick source_type list (just distinct values, fast)
  console.log('\n1. DISTINCT SOURCE_TYPES:');
  console.log('-'.repeat(50));

  const q0 = `SELECT DISTINCT source_type FROM pm_unified_ledger_v5`;
  const r0 = await clickhouse.query({ query: q0, format: 'JSONEachRow' });
  const rows0 = (await r0.json()) as any[];

  for (const r of rows0) {
    console.log(`  - ${r.source_type}`);
  }

  // 2. Per-wallet breakdown for detailed wallets
  console.log('\n' + '='.repeat(100));
  console.log('2. PER-WALLET SOURCE_TYPE BREAKDOWN (benchmark wallets):');
  console.log('='.repeat(100));

  // Load benchmark data to get error percentages
  let benchmarks: Map<string, BenchmarkResult> = new Map();
  if (fs.existsSync(REPORT_FILE)) {
    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
    for (const r of report.results) {
      benchmarks.set(r.wallet.toLowerCase(), r);
    }
  }

  // Get all benchmark wallets
  const walletsToAnalyze = [...benchmarks.keys()].slice(0, 15);

  for (const wallet of walletsToAnalyze) {
    const benchmark = benchmarks.get(wallet);
    const errorPct = benchmark?.total_pnl_error_pct || 0;
    const uiPnl = benchmark?.ui?.pnl || 0;
    const v18Pnl = benchmark?.v18?.total_pnl || 0;
    const username = benchmark?.ui?.username || 'Unknown';

    console.log(`\n--- ${username} (${wallet.substring(0, 10)}...) ---`);
    console.log(`UI PnL: $${uiPnl.toFixed(2)} | V18 PnL: $${v18Pnl.toFixed(2)} | Error: ${errorPct.toFixed(2)}%`);

    const q2 = `
      SELECT
        source_type,
        count() as rows,
        sum(usdc_delta) as sum_usdc,
        sum(token_delta) as sum_tokens
      FROM pm_unified_ledger_v5
      WHERE lower(wallet_address) = lower('${wallet}')
      GROUP BY source_type
      ORDER BY abs(sum_usdc) DESC
    `;

    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const rows2 = (await r2.json()) as any[];

    if (rows2.length === 0) {
      console.log('  (no unified ledger data)');
      continue;
    }

    console.log('Source Type          | Rows   | Sum USDC      | Sum Tokens');
    console.log('-'.repeat(65));

    let totalUsdc = 0;
    let totalTokens = 0;

    for (const r of rows2) {
      const usdc = Number(r.sum_usdc);
      const tokens = Number(r.sum_tokens);
      totalUsdc += usdc;
      totalTokens += tokens;

      console.log(
        `${String(r.source_type).padEnd(20)} | ` +
          `${String(r.rows).padStart(6)} | ` +
          `$${usdc.toFixed(2).padStart(12)} | ` +
          `${tokens.toFixed(2).padStart(12)}`
      );
    }

    console.log('-'.repeat(65));
    console.log(
      `${'TOTAL'.padEnd(20)} | ${''.padStart(6)} | ` +
        `$${totalUsdc.toFixed(2).padStart(12)} | ` +
        `${totalTokens.toFixed(2).padStart(12)}`
    );

    // Calculate what V19 variants would give
    // Need to get resolution-adjusted PnL
    const q3 = `
      WITH positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) as usdc,
          sum(token_delta) as tokens,
          any(payout_norm) as resolution
        FROM pm_unified_ledger_v5
        WHERE lower(wallet_address) = lower('${wallet}')
        GROUP BY condition_id, outcome_index
      )
      SELECT
        sum(CASE WHEN resolution IS NOT NULL
          THEN usdc + tokens * resolution
          ELSE usdc + tokens * 0.5 END) as total_pnl
      FROM positions
    `;

    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const rows3 = (await r3.json()) as any[];
    const unifiedPnl = rows3[0]?.total_pnl ? Number(rows3[0].total_pnl) : 0;

    console.log(`\nV19 (all sources): $${unifiedPnl.toFixed(2)}`);
    console.log(`Gap from UI: $${(unifiedPnl - uiPnl).toFixed(2)} (${(((unifiedPnl - uiPnl) / Math.abs(uiPnl || 1)) * 100).toFixed(1)}%)`);
  }

  // 3. Interpretation guide
  console.log('\n' + '='.repeat(100));
  console.log('3. SOURCE_TYPE INTERPRETATION GUIDE');
  console.log('='.repeat(100));
  console.log(`
Based on typical Polymarket behavior:

- CLOB / clob_maker / clob_taker: Trading on the order book
  → INCLUDE in UI PnL (this is what V18 uses)

- PayoutRedemption: Redeeming winning shares for USDC after resolution
  → INCLUDE in UI PnL (this is realized profit)

- PositionSplit: Depositing USDC to mint both YES and NO tokens
  → COMPLEX: The USDC goes out, tokens come in at $1 total value
  → This is "cost basis" but may already be netted in other flows
  → Need to test inclusion vs exclusion

- PositionsMerge: Burning YES+NO tokens to get USDC back
  → COMPLEX: Similar to split but reverse
  → Need to test inclusion vs exclusion

- USER_DEPOSIT / USER_WITHDRAWAL: Funding flows
  → EXCLUDE from PnL (not trading activity)

- BRIDGE_IN / BRIDGE_OUT: Cross-chain transfers
  → EXCLUDE from PnL (not trading activity)
`);
}

main().catch(console.error);
