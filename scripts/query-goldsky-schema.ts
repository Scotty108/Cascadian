import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function run() {
  console.log('=== TASK 1: FULL SCHEMA OF pm_user_positions ===\n');

  // Get full schema
  const schema = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_user_positions',
    format: 'JSONEachRow'
  });
  const schemaData = await schema.json() as any[];

  console.log('Columns:');
  for (const col of schemaData) {
    console.log(`  ${col.name}: ${col.type}${col.default_type ? ` (${col.default_type}: ${col.default_expression})` : ''}`);
  }

  // First, let's understand position_id format
  console.log('\n=== UNDERSTANDING position_id FORMAT ===\n');
  const samplePositions = await clickhouse.query({
    query: `
      SELECT position_id, proxy_wallet, condition_id
      FROM pm_user_positions
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await samplePositions.json() as any[];
  console.log('Sample position_id formats:');
  for (const row of sampleData) {
    console.log(`position_id: ${row.position_id}`);
    console.log(`  proxy_wallet: ${row.proxy_wallet}`);
    console.log(`  condition_id: ${row.condition_id}`);
    console.log('---');
  }

  // Check if Sports Bettor address appears in proxy_wallet
  console.log('\n=== CHECKING FOR SPORTS BETTOR ===\n');
  const sportsBettorCheck = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = lower('${SPORTS_BETTOR}')
    `,
    format: 'JSONEachRow'
  });
  const sportsBettorCount = await sportsBettorCheck.json() as any[];
  console.log(`Positions with proxy_wallet = ${SPORTS_BETTOR}: ${sportsBettorCount[0].count}`);

  // Check if it appears in position_id
  const positionIdCheck = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM pm_user_positions
      WHERE position_id LIKE '%${SPORTS_BETTOR.toLowerCase().replace('0x', '')}%'
    `,
    format: 'JSONEachRow'
  });
  const positionIdCount = await positionIdCheck.json() as any[];
  console.log(`Positions where position_id contains sports bettor address: ${positionIdCount[0].count}`);

  // Let's look at unique proxy_wallets
  console.log('\n=== SAMPLE PROXY_WALLETS ===\n');
  const uniqueWallets = await clickhouse.query({
    query: `
      SELECT DISTINCT proxy_wallet, count(*) as positions
      FROM pm_user_positions
      GROUP BY proxy_wallet
      ORDER BY positions DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const walletsData = await uniqueWallets.json() as any[];
  console.log('Top 10 proxy_wallets by position count:');
  for (const row of walletsData) {
    console.log(`  ${row.proxy_wallet}: ${row.positions} positions`);
  }

  console.log('\n=== TASK 2: SAMPLE LOSING POSITIONS (realized_pnl = 0) ===\n');

  // Query sample losing positions - try any wallet first
  const losingPositions = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_user_positions
      WHERE realized_pnl = 0
        AND total_bought > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const losingData = await losingPositions.json() as any[];

  console.log('Sample losing positions (realized_pnl = 0, total_bought > 0):');
  for (const row of losingData) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  console.log('\n=== TASK 3: ANALYSIS OF FIELDS FOR LOSS CALCULATION ===\n');

  // Analyze the available fields
  const analysis = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        countIf(realized_pnl = 0) as positions_with_zero_pnl,
        countIf(realized_pnl > 0) as positions_with_positive_pnl,
        countIf(realized_pnl < 0) as positions_with_negative_pnl,
        SUM(realized_pnl) as total_realized_pnl,
        SUM(total_bought) as total_bought_sum,
        SUM(total_sold) as total_sold_sum,
        -- For positions with zero realized_pnl, what was bought?
        sumIf(total_bought, realized_pnl = 0) as total_bought_in_zero_pnl_positions,
        sumIf(total_sold, realized_pnl = 0) as total_sold_in_zero_pnl_positions
      FROM pm_user_positions
    `,
    format: 'JSONEachRow'
  });
  const analysisData = await analysis.json() as any[];
  console.log('Global analysis:');
  console.log(JSON.stringify(analysisData[0], null, 2));

  // Calculate potential loss: For positions where realized_pnl = 0,
  // loss = total_bought - total_sold (what was spent but not recovered)
  console.log('\n=== LOSS CALCULATION HYPOTHESIS ===\n');
  console.log('Hypothesis: Loss = total_bought - total_sold (for positions where realized_pnl = 0)');

  const lossCalc = await clickhouse.query({
    query: `
      SELECT
        SUM(total_bought - total_sold) as calculated_loss
      FROM pm_user_positions
      WHERE realized_pnl = 0
        AND total_bought > total_sold
    `,
    format: 'JSONEachRow'
  });
  const lossData = await lossCalc.json() as any[];
  console.log('Calculated loss (total_bought - total_sold where realized_pnl=0):', lossData[0]);

  // ============================================================
  // FOCUS ON SPORTS BETTOR
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('=== SPORTS BETTOR DEEP DIVE ===');
  console.log('='.repeat(60) + '\n');

  // Get all positions for Sports Bettor
  const sportsBettorPositions = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = lower('${SPORTS_BETTOR}')
    `,
    format: 'JSONEachRow'
  });
  const sportsBettorData = await sportsBettorPositions.json() as any[];

  console.log(`Total positions for Sports Bettor: ${sportsBettorData.length}`);

  // Analyze PnL distribution
  let zeroCount = 0, positiveCount = 0, negativeCount = 0;
  let totalPositivePnl = 0, totalNegativePnl = 0;
  let totalBoughtZeroPnl = 0;

  for (const pos of sportsBettorData) {
    if (pos.realized_pnl === 0) {
      zeroCount++;
      totalBoughtZeroPnl += pos.total_bought;
    } else if (pos.realized_pnl > 0) {
      positiveCount++;
      totalPositivePnl += pos.realized_pnl;
    } else {
      negativeCount++;
      totalNegativePnl += pos.realized_pnl;
    }
  }

  console.log('\nPnL Distribution for Sports Bettor:');
  console.log(`  Zero PnL positions: ${zeroCount}`);
  console.log(`  Positive PnL positions: ${positiveCount}`);
  console.log(`  Negative PnL positions: ${negativeCount}`);
  console.log(`\nTotal Realized PnL (positive): ${totalPositivePnl.toLocaleString()}`);
  console.log(`Total Realized PnL (negative): ${totalNegativePnl.toLocaleString()}`);
  console.log(`Total Bought in zero-PnL positions: ${totalBoughtZeroPnl.toLocaleString()}`);

  // Sample of positions with different PnL values
  console.log('\n=== SAMPLE POSITIONS WITH POSITIVE PnL ===');
  const positivePnlSample = sportsBettorData.filter((p: any) => p.realized_pnl > 0).slice(0, 3);
  for (const pos of positivePnlSample) {
    console.log(JSON.stringify(pos, null, 2));
  }

  console.log('\n=== SAMPLE POSITIONS WITH NEGATIVE PnL ===');
  const negativePnlSample = sportsBettorData.filter((p: any) => p.realized_pnl < 0).slice(0, 3);
  for (const pos of negativePnlSample) {
    console.log(JSON.stringify(pos, null, 2));
  }

  console.log('\n=== SAMPLE POSITIONS WITH ZERO PnL (potential losses) ===');
  const zeroPnlSample = sportsBettorData.filter((p: any) => p.realized_pnl === 0 && p.total_bought > 0).slice(0, 3);
  for (const pos of zeroPnlSample) {
    console.log(JSON.stringify(pos, null, 2));
  }

  // ============================================================
  // LOSS CALCULATION ATTEMPTS
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('=== LOSS CALCULATION ATTEMPTS ===');
  console.log('='.repeat(60) + '\n');

  console.log('TARGET: $38,833,660 (expected losses)');
  console.log('');

  // Method 1: Sum of negative realized_pnl
  console.log('Method 1: SUM(realized_pnl) WHERE realized_pnl < 0');
  console.log(`  Result: $${Math.abs(totalNegativePnl / 1e6).toFixed(2)}M`);

  // Method 2: Sum of total_bought where realized_pnl = 0
  console.log('\nMethod 2: SUM(total_bought) WHERE realized_pnl = 0');
  console.log(`  Result: $${(totalBoughtZeroPnl / 1e6).toFixed(2)}M`);

  // Method 3: Combined approach
  const combinedLoss = Math.abs(totalNegativePnl) + totalBoughtZeroPnl;
  console.log('\nMethod 3: |negative_pnl| + total_bought_where_zero');
  console.log(`  Result: $${(combinedLoss / 1e6).toFixed(2)}M`);

  // Convert total_bought from raw units - check if it's in micro USDC
  console.log('\n=== UNIT ANALYSIS ===');
  console.log('total_bought values seem very large. Checking if units are micro-USDC (1e6)...');

  // Look at a few samples and their expected values
  const sampleWithBought = sportsBettorData.find((p: any) => p.total_bought > 0);
  if (sampleWithBought) {
    console.log(`Sample total_bought: ${sampleWithBought.total_bought}`);
    console.log(`  If raw: $${sampleWithBought.total_bought.toLocaleString()}`);
    console.log(`  If micro-USDC (/ 1e6): $${(sampleWithBought.total_bought / 1e6).toFixed(2)}`);
  }

  // Final summary with unit conversion
  console.log('\n=== FINAL SUMMARY (assuming micro-USDC units) ===');
  console.log(`Total Positive PnL: $${(totalPositivePnl / 1e6).toFixed(2)}M`);
  console.log(`Total Negative PnL: $${(totalNegativePnl / 1e6).toFixed(2)}M`);
  console.log(`Total Bought (zero-pnl): $${(totalBoughtZeroPnl / 1e6).toFixed(2)}M`);
  console.log(`\nNet PnL (positive + negative): $${((totalPositivePnl + totalNegativePnl) / 1e6).toFixed(2)}M`);

  // ============================================================
  // CRITICAL UNIT ANALYSIS
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('=== CRITICAL UNIT ANALYSIS ===');
  console.log('='.repeat(60) + '\n');

  console.log('TARGET LOSSES: $38,833,660');
  console.log('Raw negative PnL sum: ' + totalNegativePnl.toLocaleString());
  console.log('');

  // Try different unit conversions
  console.log('Unit conversion attempts for negative PnL:');
  console.log(`  / 1 (raw):     $${Math.abs(totalNegativePnl).toLocaleString()}`);
  console.log(`  / 1000:        $${Math.abs(totalNegativePnl / 1000).toLocaleString()}`);
  console.log(`  / 1e6:         $${Math.abs(totalNegativePnl / 1e6).toLocaleString()}`);
  console.log('');

  // The key insight: if / 1000 gives us $39.8M, that's very close!
  const lossesDiv1000 = Math.abs(totalNegativePnl / 1000);
  const target = 38833660;
  const diff = Math.abs(lossesDiv1000 - target);
  const diffPercent = (diff / target * 100).toFixed(2);

  console.log('COMPARISON TO TARGET $38,833,660:');
  console.log(`  Using / 1000: $${lossesDiv1000.toLocaleString()}`);
  console.log(`  Difference: $${diff.toLocaleString()} (${diffPercent}%)`);
  console.log('');

  // Check what total_bought units are
  console.log('=== VALIDATING UNIT HYPOTHESIS ===');

  // If realized_pnl is in units where / 1000 = dollars,
  // then realized_pnl of 16,967,684,296 should be ~$17M profit on one position
  // Let's check if total_bought makes sense with same units

  const sampleWin = sportsBettorData.filter((p: any) => p.realized_pnl > 0)[0];
  if (sampleWin) {
    console.log('\nSample WINNING position:');
    console.log(`  total_bought: ${sampleWin.total_bought.toLocaleString()}`);
    console.log(`  realized_pnl: ${sampleWin.realized_pnl.toLocaleString()}`);
    console.log(`  If / 1000: bought $${(sampleWin.total_bought / 1000).toLocaleString()}, profit $${(sampleWin.realized_pnl / 1000).toLocaleString()}`);
    console.log(`  ROI: ${((sampleWin.realized_pnl / sampleWin.total_bought) * 100).toFixed(2)}%`);
  }

  // Check the sum of ALL realized_pnl (not just negative)
  const totalRealizedPnl = totalPositivePnl + totalNegativePnl;
  console.log('\n=== TOTAL NET PnL CALCULATION ===');
  console.log(`Sum of ALL realized_pnl: ${totalRealizedPnl.toLocaleString()}`);
  console.log(`  / 1000 = $${(totalRealizedPnl / 1000).toLocaleString()}`);
  console.log('');

  // Key finding: Goldsky DOES track negative PnL
  console.log('=== KEY FINDING ===');
  console.log('Goldsky pm_user_positions DOES contain negative realized_pnl values!');
  console.log(`  Only ${negativeCount} positions have negative PnL for this wallet`);
  console.log(`  Sum of negative PnL / 1000 = $${lossesDiv1000.toLocaleString()}`);
  console.log(`  This is within ${diffPercent}% of target $38,833,660`);
  console.log('');

  // What about zero-pnl positions? Are they open or closed losers?
  console.log('=== ZERO-PNL POSITION ANALYSIS ===');
  console.log('Positions with realized_pnl = 0 could be:');
  console.log('  1. Still open (unrealized)');
  console.log('  2. Closed but lost everything (total loss = total_bought)');
  console.log('');

  // Check unrealized_pnl for zero positions
  const zeroPnlPositions = sportsBettorData.filter((p: any) => p.realized_pnl === 0);
  const openPositions = zeroPnlPositions.filter((p: any) => p.unrealized_pnl !== 0);
  const closedZero = zeroPnlPositions.filter((p: any) => p.unrealized_pnl === 0);

  console.log(`Total zero-pnl positions: ${zeroPnlPositions.length}`);
  console.log(`  With unrealized_pnl != 0 (likely open): ${openPositions.length}`);
  console.log(`  With unrealized_pnl = 0 (likely closed losers): ${closedZero.length}`);

  // Sum total_bought for closed-zero positions
  const closedZeroTotalBought = closedZero.reduce((sum: number, p: any) => sum + p.total_bought, 0);
  console.log(`\nTotal bought in closed-zero positions: ${closedZeroTotalBought.toLocaleString()}`);
  console.log(`  / 1000 = $${(closedZeroTotalBought / 1000).toLocaleString()}`);

  // Final answer
  console.log('\n' + '='.repeat(60));
  console.log('=== INVESTIGATING THE DISCREPANCY ===');
  console.log('='.repeat(60));
  console.log('');
  console.log('PROBLEM: Zero-PnL positions have $82.5B total_bought (/ 1000)');
  console.log('But target losses are only $38.8M');
  console.log('');
  console.log('These zero-PnL positions cannot all be complete losses!');
  console.log('');

  // Let's understand what these zero-pnl positions really represent
  // Check if any have been resolved (market settled)
  // Need to look at other Goldsky tables

  console.log('=== CHECKING OTHER GOLDSKY TABLES ===');

  // List all pm_ tables
  const tables = await clickhouse.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND name LIKE 'pm_%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const tablesData = await tables.json() as any[];
  console.log('\nAvailable Goldsky pm_* tables:');
  for (const t of tablesData) {
    console.log(`  ${t.name}: ${Number(t.total_rows).toLocaleString()} rows`);
  }

  // Check pm_wallet_market_pnl_v4 - this may have better PnL data
  console.log('\n=== CHECKING pm_wallet_market_pnl_v4 ===');

  const pnlSchema = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_wallet_market_pnl_v4',
    format: 'JSONEachRow'
  });
  const pnlSchemaData = await pnlSchema.json() as any[];
  console.log('\npm_wallet_market_pnl_v4 columns:');
  for (const col of pnlSchemaData) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Query Sports Bettor from this table (column is 'wallet')
  console.log('\n=== SPORTS BETTOR IN pm_wallet_market_pnl_v4 ===');
  const walletPnlCheck = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = lower('${SPORTS_BETTOR}')
    `,
    format: 'JSONEachRow'
  });
  const walletPnlCount = await walletPnlCheck.json() as any[];
  console.log(`Records for Sports Bettor in pm_wallet_market_pnl_v4: ${walletPnlCount[0].count}`);

  // Get Sports Bettor's data from pm_wallet_market_pnl_v4
  const walletPnlData = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = lower('${SPORTS_BETTOR}')
    `,
    format: 'JSONEachRow'
  });
  const walletPnlRows = await walletPnlData.json() as any[];

  // Analyze the PnL breakdown
  let v4TotalPnl = 0, v4TradingPnl = 0, v4ResolutionPnl = 0;
  let v4PositivePnl = 0, v4NegativePnl = 0;
  let resolvedCount = 0, wonCount = 0, lostCount = 0;

  for (const row of walletPnlRows) {
    v4TotalPnl += row.total_pnl;
    v4TradingPnl += row.trading_pnl;
    v4ResolutionPnl += row.resolution_pnl;

    if (row.total_pnl > 0) v4PositivePnl += row.total_pnl;
    if (row.total_pnl < 0) v4NegativePnl += row.total_pnl;

    if (row.is_resolved) {
      resolvedCount++;
      if (row.outcome_won) wonCount++;
      else lostCount++;
    }
  }

  console.log(`\nPnL Summary from pm_wallet_market_pnl_v4:`);
  console.log(`  Total positions: ${walletPnlRows.length}`);
  console.log(`  Resolved: ${resolvedCount} (Won: ${wonCount}, Lost: ${lostCount})`);
  console.log(`  Total PnL: ${v4TotalPnl.toLocaleString()}`);
  console.log(`  Trading PnL: ${v4TradingPnl.toLocaleString()}`);
  console.log(`  Resolution PnL: ${v4ResolutionPnl.toLocaleString()}`);
  console.log(`  Positive PnL sum: ${v4PositivePnl.toLocaleString()}`);
  console.log(`  Negative PnL sum: ${v4NegativePnl.toLocaleString()}`);

  // Now check if negative total_pnl matches our target
  console.log(`\n=== V4 LOSS CALCULATION ===`);
  console.log(`Target: $38,833,660`);
  console.log(`Raw negative PnL: ${Math.abs(v4NegativePnl).toLocaleString()}`);
  console.log(`  / 1 (raw):   $${Math.abs(v4NegativePnl).toLocaleString()}`);
  console.log(`  / 1000:      $${(Math.abs(v4NegativePnl) / 1000).toLocaleString()}`);
  console.log(`  / 1e6:       $${(Math.abs(v4NegativePnl) / 1e6).toLocaleString()}`);

  // Sample losing positions
  console.log('\n=== SAMPLE LOSING POSITIONS from V4 ===');
  const losingV4 = walletPnlRows.filter((r: any) => r.total_pnl < 0).slice(0, 3);
  for (const row of losingV4) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  // Sample winning positions
  console.log('\n=== SAMPLE WINNING POSITIONS from V4 ===');
  const winningV4 = walletPnlRows.filter((r: any) => r.total_pnl > 0).slice(0, 2);
  for (const row of winningV4) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  // ============================================================
  // COMPARE V4 TO TARGET AND UNDERSTAND DISCREPANCY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('=== V4 vs TARGET COMPARISON ===');
  console.log('='.repeat(60));

  const targetLoss = 38833660;
  const v4Loss = Math.abs(v4NegativePnl);
  const v4Diff = targetLoss - v4Loss;
  const v4DiffPercent = ((v4Diff / targetLoss) * 100).toFixed(2);

  console.log(`\nTarget Losses:  $${targetLoss.toLocaleString()}`);
  console.log(`V4 Losses:      $${v4Loss.toLocaleString()}`);
  console.log(`Difference:     $${v4Diff.toLocaleString()} (${v4DiffPercent}%)`);

  // Check if there are additional loss sources
  console.log('\n=== BREAKDOWN OF V4 LOSSES ===');

  // Calculate trading losses vs resolution losses
  let tradingLossSum = 0, resolutionLossSum = 0;
  for (const row of walletPnlRows) {
    if (row.trading_pnl < 0) tradingLossSum += Math.abs(row.trading_pnl);
    if (row.resolution_pnl < 0) resolutionLossSum += Math.abs(row.resolution_pnl);
  }

  console.log(`Trading losses (sold at loss): $${tradingLossSum.toLocaleString()}`);
  console.log(`Resolution losses (lost bets): $${resolutionLossSum.toLocaleString()}`);
  console.log(`Combined: $${(tradingLossSum + resolutionLossSum).toLocaleString()}`);

  // Check fees
  let totalFees = 0;
  for (const row of walletPnlRows) {
    totalFees += row.total_fees_usdc || 0;
  }
  console.log(`Total fees: $${totalFees.toLocaleString()}`);

  // The discrepancy might be due to:
  // 1. Fees not included in PnL
  // 2. Unresolved positions not included
  // 3. Different calculation methodology

  // Check unresolved positions
  const unresolvedPositions = walletPnlRows.filter((r: any) => !r.is_resolved);
  console.log(`\nUnresolved positions: ${unresolvedPositions.length}`);

  // Look at pm_user_positions again - it had 547 positions, v4 has 697
  // Why more in v4? Maybe v4 tracks by outcome_index (YES/NO separately)
  console.log('\n=== UNDERSTANDING POSITION COUNT DIFFERENCE ===');
  console.log(`pm_user_positions: 547 positions`);
  console.log(`pm_wallet_market_pnl_v4: 697 positions`);
  console.log(`Difference: ${697 - 547} more in v4`);
  console.log('Likely because v4 tracks each outcome_index separately (YES=0, NO=1)');

  // Check condition_id uniqueness in v4
  const uniqueConditions = new Set(walletPnlRows.map((r: any) => r.condition_id));
  console.log(`Unique condition_ids in v4: ${uniqueConditions.size}`);

  // Check pm_condition_resolutions
  console.log('\n=== CHECKING pm_condition_resolutions ===');
  const resSchema = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_condition_resolutions',
    format: 'JSONEachRow'
  });
  const resSchemaData = await resSchema.json() as any[];
  console.log('\npm_condition_resolutions columns:');
  for (const col of resSchemaData) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Sample from resolutions
  const resSample = await clickhouse.query({
    query: 'SELECT * FROM pm_condition_resolutions LIMIT 2',
    format: 'JSONEachRow'
  });
  const resSampleData = await resSample.json() as any[];
  console.log('\nSample from pm_condition_resolutions:');
  for (const row of resSampleData) {
    console.log(JSON.stringify(row, null, 2));
  }

  // Key insight: maybe realized_pnl only captures partial closures?
  console.log('\n=== ALTERNATIVE HYPOTHESIS ===');
  console.log('');
  console.log('The 8 positions with negative realized_pnl ($39.8M / 1000)');
  console.log('may represent PARTIAL losses from selling at a loss.');
  console.log('');
  console.log('The 358 zero-pnl positions may be:');
  console.log('  - Still open / unresolved');
  console.log('  - Total losses where user lost entire position');
  console.log('');
  console.log('If zero-pnl means "lost everything", then:');
  console.log(`  Total losses = |negative_pnl| + zero_pnl_total_bought`);
  console.log(`  But zero_pnl_total_bought = $82.5B is way too high!`);
  console.log('');

  // The issue: maybe total_bought includes ALL historical buys, not cost basis
  console.log('=== HYPOTHESIS: total_bought is cumulative, not net ===');
  console.log('');
  console.log('If user bought $100, sold $90 (loss of $10), then bought $50 more:');
  console.log('  total_bought = $150 (cumulative)');
  console.log('  realized_pnl = -$10');
  console.log('');
  console.log('This would explain why total_bought is so large.');

  // Final conclusion
  console.log('\n' + '='.repeat(60));
  console.log('=== FINAL CONCLUSION ===');
  console.log('='.repeat(60));
  console.log('');
  console.log('WE HAVE TWO OPTIONS FOR CALCULATING LOSSES:');
  console.log('');
  console.log('OPTION 1: pm_user_positions.realized_pnl (Goldsky raw)');
  console.log('  Formula: SUM(realized_pnl) WHERE realized_pnl < 0');
  console.log('  Unit: Divide by 1000 to get USD');
  console.log(`  Result: $${(Math.abs(totalNegativePnl) / 1000).toLocaleString()}`);
  console.log(`  vs Target $38,833,660: +2.48% (OVER)`);
  console.log('  Pros: Direct from Goldsky, fewer transformations');
  console.log('  Cons: Unusual unit (/ 1000), only 8 losing positions');
  console.log('');
  console.log('OPTION 2: pm_wallet_market_pnl_v4.total_pnl (Computed)');
  console.log('  Formula: SUM(total_pnl) WHERE total_pnl < 0');
  console.log('  Unit: Already in USD');
  console.log(`  Result: $${v4Loss.toLocaleString()}`);
  console.log(`  vs Target $38,833,660: -12.63% (UNDER)`);
  console.log('  Pros: Properly computed, has cost_basis, trading_pnl, resolution_pnl');
  console.log('  Cons: ~$4.9M lower than expected');
  console.log('');
  console.log('=== KEY INSIGHT ===');
  console.log('The V4 table is more reliable because:');
  console.log('  - Has proper cost_basis tracking');
  console.log('  - Separates trading_pnl from resolution_pnl');
  console.log('  - Values already in USD');
  console.log('  - Tracks resolution outcomes (won/lost)');
  console.log('');
  console.log('The 12.63% discrepancy may be due to:');
  console.log('  - Missing recent positions (last computed: ' + (walletPnlRows[0]?.computed_at || 'unknown') + ')');
  console.log('  - Different fee treatment');
  console.log('  - Incomplete market coverage');
  console.log('');
  console.log('=== RECOMMENDED FORMULA ===');
  console.log('');
  console.log('```sql');
  console.log('SELECT');
  console.log('  ABS(SUM(total_pnl)) as total_losses');
  console.log('FROM pm_wallet_market_pnl_v4');
  console.log('WHERE lower(wallet) = lower(:wallet_address)');
  console.log('  AND total_pnl < 0');
  console.log('```');
  console.log('');
  console.log('OR for more granular losses:');
  console.log('');
  console.log('```sql');
  console.log('SELECT');
  console.log('  SUM(CASE WHEN trading_pnl < 0 THEN ABS(trading_pnl) ELSE 0 END) as trading_losses,');
  console.log('  SUM(CASE WHEN resolution_pnl < 0 THEN ABS(resolution_pnl) ELSE 0 END) as resolution_losses,');
  console.log('  SUM(CASE WHEN total_pnl < 0 THEN ABS(total_pnl) ELSE 0 END) as total_losses');
  console.log('FROM pm_wallet_market_pnl_v4');
  console.log('WHERE lower(wallet) = lower(:wallet_address)');
  console.log('```');
  console.log('');
  console.log('This table has the fields we need:');
  console.log('  - remaining_cost_basis: What was spent');
  console.log('  - resolution_payout: What was received');
  console.log('  - resolution_pnl: Payout - cost_basis (negative = loss)');
  console.log('');

  await clickhouse.close();
}

run().catch(console.error);
