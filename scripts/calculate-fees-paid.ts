import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("TEST #2: Calculate Total Fees Paid");
  console.log("═".repeat(80));
  console.log();

  // First, check if clob_fills has fee columns
  console.log("Checking clob_fills schema for fee columns...");
  const schemaCheck = await clickhouse.query({
    query: 'DESCRIBE TABLE clob_fills',
    format: 'JSONEachRow'
  });
  const schema = await schemaCheck.json();

  const feeColumns = schema.filter(col =>
    col.name.toLowerCase().includes('fee')
  );

  if (feeColumns.length === 0) {
    console.log("❌ No fee columns found in clob_fills");
    console.log();
    console.log("Available columns:");
    console.table(schema.slice(0, 20).map(c => ({ name: c.name, type: c.type })));
    return;
  }

  console.log(`✅ Found ${feeColumns.length} fee-related column(s):`);
  feeColumns.forEach(col => console.log(`  - ${col.name} (${col.type})`));
  console.log();

  // Try to calculate fees using fee_rate_bps if it exists
  const hasFeeRateBps = feeColumns.some(c => c.name === 'fee_rate_bps');
  const hasMakerFee = feeColumns.some(c => c.name === 'maker_fee');
  const hasTakerFee = feeColumns.some(c => c.name === 'taker_fee');

  if (hasFeeRateBps) {
    console.log("Calculating fees using fee_rate_bps...");
    const feeQuery = `
      SELECT
        sum(price * size * fee_rate_bps / 10000.0 / 1000000.0) AS total_fees_usd,
        count(*) AS num_fills,
        avg(fee_rate_bps) AS avg_fee_bps
      FROM clob_fills
      WHERE lower(proxy_wallet) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
        AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `;

    const res = await clickhouse.query({
      query: feeQuery,
      format: 'JSONEachRow'
    });
    const [result] = await res.json();

    const totalFees = Number(result.total_fees_usd);

    console.log();
    console.log("═".repeat(80));
    console.log("RESULTS:");
    console.log(`  Total fills:       ${result.num_fills}`);
    console.log(`  Avg fee rate:      ${Number(result.avg_fee_bps).toFixed(2)} bps`);
    console.log(`  Total fees paid:   $${totalFees.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log();
    console.log("Comparison:");
    console.log(`  Current P&L:       $34,990.56`);
    console.log(`  Expected (Dome):   $87,030.51`);
    console.log(`  Gap:               $52,039.95`);
    console.log();
    console.log(`  Fees vs Gap:       $${totalFees.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} vs $52,040`);
    console.log();

    if (Math.abs(totalFees - 52040) < 5000) {
      console.log(`  ✅ FEES ACCOUNT FOR THE GAP!`);
      console.log();
      console.log("  Next step: Subtract fees from cashflows in P&L calculation");
    } else {
      console.log(`  ❌ Fees don't fully explain the gap (diff: $${Math.abs(totalFees - 52040).toLocaleString()})`);
    }
    console.log("═".repeat(80));

  } else if (hasMakerFee || hasTakerFee) {
    console.log("Calculating fees using maker_fee/taker_fee columns...");

    let feeQuery;
    if (hasMakerFee && hasTakerFee) {
      feeQuery = `
        SELECT
          sum((maker_fee + taker_fee) / 1000000.0) AS total_fees_usd,
          count(*) AS num_fills
        FROM clob_fills
        WHERE lower(proxy_wallet) = lower('${wallet}')
          AND condition_id IS NOT NULL
      `;
    } else {
      const feeCol = hasMakerFee ? 'maker_fee' : 'taker_fee';
      feeQuery = `
        SELECT
          sum(${feeCol} / 1000000.0) AS total_fees_usd,
          count(*) AS num_fills
        FROM clob_fills
        WHERE lower(proxy_wallet) = lower('${wallet}')
          AND condition_id IS NOT NULL
      `;
    }

    const res = await clickhouse.query({
      query: feeQuery,
      format: 'JSONEachRow'
    });
    const [result] = await res.json();

    const totalFees = Number(result.total_fees_usd);

    console.log();
    console.log("═".repeat(80));
    console.log("RESULTS:");
    console.log(`  Total fills:       ${result.num_fills}`);
    console.log(`  Total fees paid:   $${totalFees.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log();
    console.log("Comparison:");
    console.log(`  Gap:               $52,039.95`);
    console.log(`  Fees vs Gap:       $${totalFees.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} vs $52,040`);
    console.log("═".repeat(80));

  } else {
    console.log("⚠️  Unable to determine fee calculation method from available columns");
  }
}

main().catch(console.error);
