/**
 * Inspect User Positions Data Quality
 *
 * Analyzes what data we're actually getting from the Goldsky backfill
 * to understand if columns are populated or zeros/nulls
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('PM_USER_POSITIONS_V2 - ACTUAL DATA QUALITY ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Get row count and basic stats
  const stats = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(user) as unique_users,
        uniqExact(token_id) as unique_tokens,
        -- avg_price analysis
        countIf(avg_price = 0) as avg_price_zero,
        countIf(avg_price > 0) as avg_price_positive,
        min(avg_price) as min_avg_price,
        max(avg_price) as max_avg_price,
        avg(avg_price) as avg_avg_price,
        -- realized_pnl analysis
        countIf(realized_pnl = 0) as realized_pnl_zero,
        countIf(realized_pnl != 0) as realized_pnl_nonzero,
        countIf(realized_pnl > 0) as realized_pnl_positive,
        countIf(realized_pnl < 0) as realized_pnl_negative,
        min(realized_pnl) as min_realized_pnl,
        max(realized_pnl) as max_realized_pnl,
        sum(realized_pnl) as sum_realized_pnl,
        -- amount analysis
        countIf(amount = 0) as amount_zero,
        countIf(amount > 0) as amount_positive,
        countIf(amount < 0) as amount_negative,
        min(amount) as min_amount,
        max(amount) as max_amount,
        -- total_bought analysis
        countIf(total_bought = 0) as total_bought_zero,
        countIf(total_bought > 0) as total_bought_positive,
        min(total_bought) as min_total_bought,
        max(total_bought) as max_total_bought
      FROM pm_user_positions_v2
    `,
    format: 'JSONEachRow',
  });
  const s = (await stats.json())[0] as any;

  const totalRows = Number(s.total_rows);
  console.log(`Total Rows:     ${totalRows.toLocaleString()}`);
  console.log(`Unique Users:   ${Number(s.unique_users).toLocaleString()}`);
  console.log(`Unique Tokens:  ${Number(s.unique_tokens).toLocaleString()}`);

  console.log('\n--- avg_price (cost basis) ---');
  console.log(`  Zero:         ${Number(s.avg_price_zero).toLocaleString()} (${((s.avg_price_zero / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Positive:     ${Number(s.avg_price_positive).toLocaleString()} (${((s.avg_price_positive / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Min:          ${Number(s.min_avg_price).toLocaleString()}`);
  console.log(`  Max:          ${Number(s.max_avg_price).toLocaleString()}`);
  console.log(`  Avg:          ${Number(s.avg_avg_price).toLocaleString()}`);
  console.log(`  If /1e6:      ${(Number(s.avg_avg_price) / 1e6).toFixed(6)} USDC`);

  console.log('\n--- realized_pnl ---');
  console.log(`  Zero:         ${Number(s.realized_pnl_zero).toLocaleString()} (${((s.realized_pnl_zero / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Non-zero:     ${Number(s.realized_pnl_nonzero).toLocaleString()} (${((s.realized_pnl_nonzero / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Positive:     ${Number(s.realized_pnl_positive).toLocaleString()}`);
  console.log(`  Negative:     ${Number(s.realized_pnl_negative).toLocaleString()}`);
  console.log(`  Min:          ${Number(s.min_realized_pnl).toLocaleString()} (${(Number(s.min_realized_pnl) / 1e6).toFixed(2)} if /1e6)`);
  console.log(`  Max:          ${Number(s.max_realized_pnl).toLocaleString()} (${(Number(s.max_realized_pnl) / 1e6).toFixed(2)} if /1e6)`);
  console.log(`  Sum:          ${Number(s.sum_realized_pnl).toLocaleString()} ($${(Number(s.sum_realized_pnl) / 1e6).toLocaleString()} if /1e6)`);

  console.log('\n--- amount (position size) ---');
  console.log(`  Zero:         ${Number(s.amount_zero).toLocaleString()} (${((s.amount_zero / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Positive:     ${Number(s.amount_positive).toLocaleString()} (${((s.amount_positive / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Negative:     ${Number(s.amount_negative).toLocaleString()}`);
  console.log(`  Min:          ${Number(s.min_amount).toLocaleString()}`);
  console.log(`  Max:          ${Number(s.max_amount).toLocaleString()}`);

  console.log('\n--- total_bought ---');
  console.log(`  Zero:         ${Number(s.total_bought_zero).toLocaleString()} (${((s.total_bought_zero / totalRows) * 100).toFixed(1)}%)`);
  console.log(`  Positive:     ${Number(s.total_bought_positive).toLocaleString()} (${((s.total_bought_positive / totalRows) * 100).toFixed(1)}%)`);

  // Sample actual rows with good data
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('SAMPLE ROWS WITH NON-ZERO realized_pnl');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const sampleNonZero = await clickhouse.query({
    query: `
      SELECT
        user,
        token_id,
        avg_price,
        realized_pnl,
        amount,
        total_bought,
        block_range
      FROM pm_user_positions_v2
      WHERE realized_pnl != 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleNonZeroRows: any[] = await sampleNonZero.json();

  if (sampleNonZeroRows.length === 0) {
    console.log('⚠️  NO ROWS WITH NON-ZERO realized_pnl YET');
  } else {
    for (const r of sampleNonZeroRows) {
      console.log(`User: ${r.user}`);
      console.log(`  token_id:     ${r.token_id}`);
      console.log(`  avg_price:    ${r.avg_price} → $${(Number(r.avg_price) / 1e6).toFixed(4)}`);
      console.log(`  realized_pnl: ${r.realized_pnl} → $${(Number(r.realized_pnl) / 1e6).toFixed(2)}`);
      console.log(`  amount:       ${r.amount} → ${(Number(r.amount) / 1e6).toFixed(4)} shares`);
      console.log(`  total_bought: ${r.total_bought} → ${(Number(r.total_bought) / 1e6).toFixed(4)} shares`);
      console.log(`  block_range:  ${r.block_range}`);
      console.log('');
    }
  }

  // Sample rows with zero realized_pnl (open positions?)
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('SAMPLE ROWS WITH ZERO realized_pnl (likely open positions)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const sampleZero = await clickhouse.query({
    query: `
      SELECT
        user,
        token_id,
        avg_price,
        realized_pnl,
        amount,
        total_bought,
        block_range
      FROM pm_user_positions_v2
      WHERE realized_pnl = 0 AND amount > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleZeroRows: any[] = await sampleZero.json();

  for (const r of sampleZeroRows) {
    console.log(`User: ${r.user}`);
    console.log(`  token_id:     ${r.token_id}`);
    console.log(`  avg_price:    ${r.avg_price} → $${(Number(r.avg_price) / 1e6).toFixed(4)}`);
    console.log(`  realized_pnl: ${r.realized_pnl} (zero = not yet realized)`);
    console.log(`  amount:       ${r.amount} → ${(Number(r.amount) / 1e6).toFixed(4)} shares HELD`);
    console.log(`  total_bought: ${r.total_bought} → ${(Number(r.total_bought) / 1e6).toFixed(4)} shares bought`);
    console.log(`  block_range:  ${r.block_range}`);
    console.log('');
  }

  // Check schema for all columns
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('FULL SCHEMA CHECK');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const schema = await clickhouse.query({
    query: `DESCRIBE TABLE pm_user_positions_v2`,
    format: 'JSONEachRow',
  });
  const cols: any[] = await schema.json();

  console.log('Column'.padEnd(25) + 'Type');
  console.log('-'.repeat(60));
  for (const col of cols) {
    console.log(`${col.name.padEnd(25)} ${col.type}`);
  }

  // The key question
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('PNL CALCULATION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('What user_positions gives us:');
  console.log('  - avg_price: Weighted average cost per share (in raw units, /1e6 for USDC)');
  console.log('  - realized_pnl: PnL already realized (trading + resolution)');
  console.log('  - amount: Current position size (shares held)');
  console.log('  - total_bought: Total shares ever bought');
  console.log('');
  console.log('To calculate TOTAL PnL per wallet:');
  console.log('');
  console.log('  REALIZED = sum(realized_pnl) across all positions');
  console.log('');
  console.log('  UNREALIZED per position = (current_price - avg_price) * amount');
  console.log('  where current_price comes from:');
  console.log('    - Live price API for open markets');
  console.log('    - Resolution price (0 or 1) for resolved markets');
  console.log('');
  console.log('  TOTAL = REALIZED + sum(UNREALIZED)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
