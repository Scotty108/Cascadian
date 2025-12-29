import * as fs from "fs";
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

interface SafeWallet {
  wallet: string;
  uiPnL: number;
  v29UiParityPnL: number;
  v29RealizedPnL: number;
  v29UnrealizedPnL: number;
  v29ResolvedUnredeemed: number;
  v29UiParityError: number;
  v29UiParityPctError: number;
  v23cPnL: number;
  tags: {
    isTraderStrict: boolean;
    splitCount: number;
    mergeCount: number;
    clobCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
}

const wallets: SafeWallet[] = JSON.parse(
  fs.readFileSync("tmp/safe_trader_strict_wallets_2025_12_06.json", "utf-8")
);

interface CashPnLResult {
  wallet: string;
  uiPnL: number;
  v29UiParityPnL: number;
  cashPnL: number;
  uiVsCashDelta: number;
  uiVsCashPctDelta: number;
  v29VsCashDelta: number;
  v29VsCashPctDelta: number;
  clobEvents: number;
  splitEvents: number;
  mergeEvents: number;
  totalEvents: number;
}

async function computeCashPnL(wallet: string): Promise<{
  cashPnL: number;
  clobCount: number;
  splitCount: number;
  mergeCount: number;
}> {
  const query = `
    WITH
      -- Deduplicated CLOB events
      clob AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) / 1000000.0 as usdc,
          any(token_amount) / 1000000.0 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String}
          AND is_deleted = 0
        GROUP BY event_id
      ),
      clob_cash AS (
        SELECT
          -- BUY means USDC out (negative), SELL means USDC in (positive)
          -- But pm_trader_events_v2.usdc_amount is already absolute/unsigned
          sum(CASE WHEN side = 'SELL' THEN usdc WHEN side = 'BUY' THEN -usdc ELSE 0 END) as cash_flow,
          count() as clob_count
        FROM clob
      ),
      -- Split events: receive shares, lose cash
      split AS (
        SELECT
          sum(-toFloat64OrZero(amount_or_payout) / 1000000.0) as cash_flow,
          count() as split_count
        FROM pm_ctf_events
        WHERE user_address = {wallet:String}
          AND event_type = 'split'
          AND is_deleted = 0
      ),
      -- Merge events: gain cash, lose shares
      merge AS (
        SELECT
          sum(toFloat64OrZero(amount_or_payout) / 1000000.0) as cash_flow,
          count() as merge_count
        FROM pm_ctf_events
        WHERE user_address = {wallet:String}
          AND event_type = 'merge'
          AND is_deleted = 0
      )
    SELECT
      clob_cash.cash_flow + COALESCE(split.cash_flow, 0) + COALESCE(merge.cash_flow, 0) as total_cash_pnl,
      clob_cash.clob_count,
      COALESCE(split.split_count, 0) as split_count,
      COALESCE(merge.merge_count, 0) as merge_count
    FROM clob_cash
    LEFT JOIN split ON 1=1
    LEFT JOIN merge ON 1=1
  `;

  const result = await client.query({
    query,
    query_params: { wallet },
    format: "JSONEachRow",
  });

  const rows = await result.json<any>();
  if (rows.length === 0) {
    return { cashPnL: 0, clobCount: 0, splitCount: 0, mergeCount: 0 };
  }

  const row = rows[0];
  return {
    cashPnL: Number(row.total_cash_pnl || 0),
    clobCount: Number(row.clob_count || 0),
    splitCount: Number(row.split_count || 0),
    mergeCount: Number(row.merge_count || 0),
  };
}

async function main() {
  console.log("\n=== COMPUTING CASH PNL FOR SAFE_TRADER_STRICT WALLETS ===\n");

  const results: CashPnLResult[] = [];

  for (const w of wallets) {
    console.log(`Processing ${w.wallet}...`);
    const { cashPnL, clobCount, splitCount, mergeCount } = await computeCashPnL(w.wallet);

    const uiVsCashDelta = w.uiPnL - cashPnL;
    const v29VsCashDelta = w.v29UiParityPnL - cashPnL;

    const uiVsCashPctDelta = cashPnL !== 0 ? uiVsCashDelta / Math.abs(cashPnL) : 0;
    const v29VsCashPctDelta = cashPnL !== 0 ? v29VsCashDelta / Math.abs(cashPnL) : 0;

    results.push({
      wallet: w.wallet,
      uiPnL: w.uiPnL,
      v29UiParityPnL: w.v29UiParityPnL,
      cashPnL,
      uiVsCashDelta,
      uiVsCashPctDelta,
      v29VsCashDelta,
      v29VsCashPctDelta,
      clobEvents: clobCount,
      splitEvents: splitCount,
      mergeEvents: mergeCount,
      totalEvents: clobCount + splitCount + mergeCount,
    });
  }

  await client.close();

  // Sort by V29 vs Cash absolute percent error
  results.sort((a, b) => Math.abs(b.v29VsCashPctDelta) - Math.abs(a.v29VsCashPctDelta));

  // Generate markdown report
  const report = generateMarkdownReport(results);
  fs.writeFileSync("docs/reports/V29_VS_CASH_SAFE_TRADER_STRICT_2025_12_06.md", report);

  console.log("\n✅ Report written to: docs/reports/V29_VS_CASH_SAFE_TRADER_STRICT_2025_12_06.md");
  console.log(`\nProcessed ${results.length} SAFE_TRADER_STRICT wallets\n`);

  // Print summary stats
  printSummary(results);
}

function generateMarkdownReport(results: CashPnLResult[]): string {
  const now = new Date().toISOString().split("T")[0];

  let md = `# V29 vs Cash PnL: SAFE_TRADER_STRICT Cohort
**Generated:** ${now}
**Terminal:** Claude Terminal 2 (Data Health and Engine Safety)

## Executive Summary

This report compares V29 UiParity PnL against pure cash flow PnL for the SAFE_TRADER_STRICT cohort.

**SAFE_TRADER_STRICT Definition:**
- \`isTraderStrict === true\`
- \`splitCount === 0\`
- \`mergeCount === 0\`
- \`inventoryMismatch === 0\`
- \`missingResolutions === 0\`

**Wallets in cohort:** ${results.length}

## Results Table

| Wallet | UI PnL | V29 UiParity | Cash PnL | UI vs Cash Δ | UI vs Cash % | V29 vs Cash Δ | V29 vs Cash % | CLOB | Split | Merge | Total Events |
|--------|-------:|-------------:|---------:|-------------:|-------------:|--------------:|--------------:|-----:|------:|------:|-------------:|
`;

  for (const r of results) {
    md += `| \`${r.wallet.slice(0, 10)}...\` `;
    md += `| $${r.uiPnL.toFixed(0)} `;
    md += `| $${r.v29UiParityPnL.toFixed(0)} `;
    md += `| $${r.cashPnL.toFixed(0)} `;
    md += `| $${r.uiVsCashDelta.toFixed(0)} `;
    md += `| ${(r.uiVsCashPctDelta * 100).toFixed(2)}% `;
    md += `| $${r.v29VsCashDelta.toFixed(0)} `;
    md += `| ${(r.v29VsCashPctDelta * 100).toFixed(2)}% `;
    md += `| ${r.clobEvents} `;
    md += `| ${r.splitEvents} `;
    md += `| ${r.mergeEvents} `;
    md += `| ${r.totalEvents} |\n`;
  }

  md += `\n## Distribution Analysis\n\n`;
  md += analyzeDistribution(results);

  md += `\n## Key Findings\n\n`;
  md += generateFindings(results);

  md += `\n---\n**Signed:** Claude Terminal 2\n`;

  return md;
}

function analyzeDistribution(results: CashPnLResult[]): string {
  const buckets = {
    "0-3%": 0,
    "3-5%": 0,
    "5-10%": 0,
    "10-20%": 0,
    "20%+": 0,
  };

  for (const r of results) {
    const err = Math.abs(r.v29VsCashPctDelta) * 100;
    if (err < 3) buckets["0-3%"]++;
    else if (err < 5) buckets["3-5%"]++;
    else if (err < 10) buckets["5-10%"]++;
    else if (err < 20) buckets["10-20%"]++;
    else buckets["20%+"]++;
  }

  let md = "### V29 vs Cash Error Distribution\n\n";
  for (const [bucket, count] of Object.entries(buckets)) {
    const pct = ((count / results.length) * 100).toFixed(1);
    md += `- **${bucket}:** ${count} wallets (${pct}%)\n`;
  }

  return md;
}

function generateFindings(results: CashPnLResult[]): string {
  const under3pct = results.filter(r => Math.abs(r.v29VsCashPctDelta) < 0.03);
  const over10pct = results.filter(r => Math.abs(r.v29VsCashPctDelta) >= 0.10);

  const avgV29Error = results.reduce((sum, r) => sum + Math.abs(r.v29VsCashPctDelta), 0) / results.length;
  const avgUiError = results.reduce((sum, r) => sum + Math.abs(r.uiVsCashPctDelta), 0) / results.length;

  let md = `1. **${under3pct.length}/${results.length} wallets** have V29 vs Cash error under 3%\n`;
  md += `2. **${over10pct.length}/${results.length} wallets** have V29 vs Cash error over 10%\n`;
  md += `3. **Average V29 vs Cash error:** ${(avgV29Error * 100).toFixed(2)}%\n`;
  md += `4. **Average UI vs Cash error:** ${(avgUiError * 100).toFixed(2)}%\n`;
  md += `5. **Median V29 vs Cash error:** ${(Math.abs(results[Math.floor(results.length / 2)]?.v29VsCashPctDelta || 0) * 100).toFixed(2)}%\n\n`;

  md += `### High-Error Wallets (V29 vs Cash > 10%)\n\n`;
  if (over10pct.length > 0) {
    md += `These wallets show significant deviation between V29 and cash flow:\n\n`;
    for (const w of over10pct.slice(0, 5)) {
      md += `- \`${w.wallet}\`: V29=$${w.v29UiParityPnL.toFixed(0)}, Cash=$${w.cashPnL.toFixed(0)}, Error=${(w.v29VsCashPctDelta * 100).toFixed(2)}%\n`;
    }
  } else {
    md += `None - excellent coverage!\n`;
  }

  return md;
}

function printSummary(results: CashPnLResult[]) {
  console.log("=== SUMMARY STATISTICS ===\n");

  const under3pct = results.filter(r => Math.abs(r.v29VsCashPctDelta) < 0.03);
  const under5pct = results.filter(r => Math.abs(r.v29VsCashPctDelta) < 0.05);
  const over10pct = results.filter(r => Math.abs(r.v29VsCashPctDelta) >= 0.10);

  console.log(`Wallets with V29 vs Cash error < 3%: ${under3pct.length}/${results.length}`);
  console.log(`Wallets with V29 vs Cash error < 5%: ${under5pct.length}/${results.length}`);
  console.log(`Wallets with V29 vs Cash error ≥ 10%: ${over10pct.length}/${results.length}`);

  const avgV29Error = results.reduce((sum, r) => sum + Math.abs(r.v29VsCashPctDelta), 0) / results.length;
  const avgUiError = results.reduce((sum, r) => sum + Math.abs(r.uiVsCashPctDelta), 0) / results.length;

  console.log(`\nAverage V29 vs Cash error: ${(avgV29Error * 100).toFixed(2)}%`);
  console.log(`Average UI vs Cash error: ${(avgUiError * 100).toFixed(2)}%`);

  console.log(`\nTop 3 wallets by V29 vs Cash error:\n`);
  for (const r of results.slice(0, 3)) {
    console.log(`  ${r.wallet}`);
    console.log(`    Cash: $${r.cashPnL.toFixed(2)}`);
    console.log(`    V29:  $${r.v29UiParityPnL.toFixed(2)} (${(r.v29VsCashPctDelta * 100).toFixed(2)}% error)`);
    console.log(`    UI:   $${r.uiPnL.toFixed(2)} (${(r.uiVsCashPctDelta * 100).toFixed(2)}% error)`);
    console.log();
  }
}

main().catch(console.error);
