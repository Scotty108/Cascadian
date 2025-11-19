import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateEmptyConditionIDs() {
  console.log('=== Priority 1: Investigate Empty Condition ID Trades ===\n');
  console.log('🚨 CRITICAL: 174 trades (22%) have EMPTY condition_id field\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Query 1: Get all empty condition_id trades
  const emptyQuery = `
    SELECT
      timestamp,
      wallet_address,
      trade_direction,
      outcome_index_v3,
      shares,
      usd_value,
      condition_id_norm_v3,
      length(condition_id_norm_v3) AS cid_length,
      trade_id
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '')
    ORDER BY usd_value DESC
    LIMIT 50
  `;

  const emptyResult = await clickhouse.query({ query: emptyQuery, format: 'JSONEachRow' });
  const emptyTrades = await emptyResult.json<any[]>();

  console.log(`Found ${emptyTrades.length} empty condition_id trades (showing top 50 by volume):\n`);

  console.log('| # | Timestamp           | Side | Out | USD Value    | Shares        | CID Len | Wallet Match |');
  console.log('|---|---------------------|------|-----|--------------|---------------|---------|--------------|');

  emptyTrades.slice(0, 20).forEach((trade, idx) => {
    const walletMatch = trade.wallet_address.toLowerCase() === EOA.toLowerCase() ? '✅' : '❌';
    console.log(`| ${String(idx + 1).padStart(2)} | ${trade.timestamp} | ${trade.trade_direction.padEnd(4)} | ${String(trade.outcome_index_v3 || 'N/A').padStart(3)} | $${String(Number(trade.usd_value).toLocaleString()).padStart(10)} | ${String(trade.shares || 'N/A').padStart(13)} | ${String(trade.cid_length).padStart(7)} | ${walletMatch.padEnd(12)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Check wallet_address consistency
  const walletAddresses = [...new Set(emptyTrades.map(t => t.wallet_address.toLowerCase()))];
  console.log(`WALLET ADDRESS CHECK:\n`);
  console.log(`Unique wallet addresses in empty trades: ${walletAddresses.length}\n`);

  if (walletAddresses.length === 1 && walletAddresses[0] === EOA.toLowerCase()) {
    console.log('✅ All empty condition_id trades have correct wallet_address\n');
  } else {
    console.log('⚠️  Multiple wallet addresses found:\n');
    walletAddresses.forEach(addr => {
      const count = emptyTrades.filter(t => t.wallet_address.toLowerCase() === addr).length;
      const isEOA = addr === EOA.toLowerCase();
      console.log(`  ${addr} ${isEOA ? '(TARGET)' : '(OTHER)'}: ${count} trades`);
    });
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Aggregate statistics
  const stats = {
    total_trades: emptyTrades.length,
    total_volume: emptyTrades.reduce((sum, t) => sum + Number(t.usd_value || 0), 0),
    buy_count: emptyTrades.filter(t => t.trade_direction === 'BUY').length,
    sell_count: emptyTrades.filter(t => t.trade_direction === 'SELL').length,
    avg_trade_size: 0,
    earliest_trade: emptyTrades[emptyTrades.length - 1]?.timestamp,
    latest_trade: emptyTrades[0]?.timestamp
  };
  stats.avg_trade_size = stats.total_volume / stats.total_trades;

  console.log('AGGREGATE STATISTICS:\n');
  console.log(`Total trades with empty CID:     ${stats.total_trades}`);
  console.log(`Total volume:                    $${stats.total_volume.toLocaleString()}`);
  console.log(`Average trade size:              $${stats.avg_trade_size.toLocaleString()}`);
  console.log(`BUY trades:                      ${stats.buy_count} (${((stats.buy_count / stats.total_trades) * 100).toFixed(1)}%)`);
  console.log(`SELL trades:                     ${stats.sell_count} (${((stats.sell_count / stats.total_trades) * 100).toFixed(1)}%)`);
  console.log(`Date range:                      ${stats.earliest_trade} to ${stats.latest_trade}\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Time distribution
  const timeDistQuery = `
    SELECT
      toYYYYMM(timestamp) AS month,
      count() AS trades,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '')
    GROUP BY month
    ORDER BY month DESC
  `;

  const timeResult = await clickhouse.query({ query: timeDistQuery, format: 'JSONEachRow' });
  const timeDist = await timeResult.json<any[]>();

  console.log('TIME DISTRIBUTION:\n');
  console.log('| Month   | Trades | Volume         | % of Month |');
  console.log('|---------|--------|----------------|------------|');

  for (const row of timeDist) {
    // Get total trades for this month
    const monthTotalQuery = `
      SELECT count() AS total
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND toYYYYMM(timestamp) = ${row.month}
    `;

    const monthTotalResult = await clickhouse.query({ query: monthTotalQuery, format: 'JSONEachRow' });
    const monthTotal = await monthTotalResult.json<any[]>();

    const percentOfMonth = ((Number(row.trades) / Number(monthTotal[0].total)) * 100).toFixed(1);

    console.log(`| ${row.month} | ${String(row.trades).padStart(6)} | $${String(Number(row.volume).toLocaleString()).padStart(12)} | ${String(percentOfMonth).padStart(9)}% |`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Compare with valid trades
  const validQuery = `
    SELECT
      count() AS total_valid,
      sum(abs(usd_value)) AS valid_volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
      AND length(condition_id_norm_v3) = 64
  `;

  const validResult = await clickhouse.query({ query: validQuery, format: 'JSONEachRow' });
  const validData = await validResult.json<any[]>();

  const totalQuery = `
    SELECT
      count() AS total_all,
      sum(abs(usd_value)) AS total_volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json<any[]>();

  console.log('COMPARISON WITH VALID TRADES:\n');
  console.log(`Valid trades (64-char CID):      ${validData[0].total_valid} (${((Number(validData[0].total_valid) / Number(totalData[0].total_all)) * 100).toFixed(1)}%)`);
  console.log(`Empty CID trades:                ${stats.total_trades} (${((stats.total_trades / Number(totalData[0].total_all)) * 100).toFixed(1)}%)`);
  console.log(`Total trades:                    ${totalData[0].total_all}\n`);

  console.log(`Valid volume:                    $${Number(validData[0].valid_volume).toLocaleString()} (${((Number(validData[0].valid_volume) / Number(totalData[0].total_volume)) * 100).toFixed(1)}%)`);
  console.log(`Empty CID volume:                $${stats.total_volume.toLocaleString()} (${((stats.total_volume / Number(totalData[0].total_volume)) * 100).toFixed(1)}%)`);
  console.log(`Total volume:                    $${Number(totalData[0].total_volume).toLocaleString()}\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check if empty trades have other identifying fields
  console.log('FIELD COMPLETENESS CHECK:\n');

  const fieldCheckQuery = `
    SELECT
      countIf(trade_id IS NOT NULL AND trade_id != '') AS has_trade_id,
      countIf(timestamp IS NOT NULL) AS has_timestamp,
      countIf(wallet_address IS NOT NULL AND wallet_address != '') AS has_wallet,
      countIf(trade_direction IS NOT NULL AND trade_direction != '') AS has_direction,
      countIf(outcome_index_v3 IS NOT NULL) AS has_outcome,
      countIf(shares IS NOT NULL) AS has_shares,
      countIf(usd_value IS NOT NULL) AS has_usd_value,
      count() AS total
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '')
  `;

  const fieldResult = await clickhouse.query({ query: fieldCheckQuery, format: 'JSONEachRow' });
  const fieldData = await fieldResult.json<any[]>();

  const total = Number(fieldData[0].total);

  console.log('| Field            | Has Value | Missing | % Complete |');
  console.log('|------------------|-----------|---------|------------|');
  console.log(`| trade_id         | ${String(fieldData[0].has_trade_id).padStart(9)} | ${String(total - Number(fieldData[0].has_trade_id)).padStart(7)} | ${String(((Number(fieldData[0].has_trade_id) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| timestamp        | ${String(fieldData[0].has_timestamp).padStart(9)} | ${String(total - Number(fieldData[0].has_timestamp)).padStart(7)} | ${String(((Number(fieldData[0].has_timestamp) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| wallet_address   | ${String(fieldData[0].has_wallet).padStart(9)} | ${String(total - Number(fieldData[0].has_wallet)).padStart(7)} | ${String(((Number(fieldData[0].has_wallet) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| trade_direction  | ${String(fieldData[0].has_direction).padStart(9)} | ${String(total - Number(fieldData[0].has_direction)).padStart(7)} | ${String(((Number(fieldData[0].has_direction) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| outcome_index_v3 | ${String(fieldData[0].has_outcome).padStart(9)} | ${String(total - Number(fieldData[0].has_outcome)).padStart(7)} | ${String(((Number(fieldData[0].has_outcome) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| shares           | ${String(fieldData[0].has_shares).padStart(9)} | ${String(total - Number(fieldData[0].has_shares)).padStart(7)} | ${String(((Number(fieldData[0].has_shares) / total) * 100).toFixed(1)).padStart(9)}% |`);
  console.log(`| usd_value        | ${String(fieldData[0].has_usd_value).padStart(9)} | ${String(total - Number(fieldData[0].has_usd_value)).padStart(7)} | ${String(((Number(fieldData[0].has_usd_value) / total) * 100).toFixed(1)).padStart(9)}% |`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Recommendation
  console.log('RECOMMENDATIONS:\n');

  if (walletAddresses.length === 1 && Number(fieldData[0].has_wallet) === total) {
    console.log('✅ Wallet address is consistent and complete\n');
  } else {
    console.log('⚠️  Wallet address issues detected - verify attribution\n');
  }

  const fieldsComplete = Number(fieldData[0].has_timestamp) === total &&
                        Number(fieldData[0].has_direction) === total &&
                        Number(fieldData[0].has_usd_value) === total;

  if (fieldsComplete) {
    console.log('✅ Core trade fields (timestamp, direction, usd_value) are complete');
    console.log('   → These trades are REAL but missing condition_id');
    console.log('   → Options:');
    console.log('     1. Attempt to backfill condition_id from trade_id or other identifiers');
    console.log('     2. Exclude these trades from PnL calculations');
    console.log('     3. Investigate data source to understand why condition_id is missing\n');
  } else {
    console.log('❌ Core trade fields are INCOMPLETE');
    console.log('   → These might be corrupted/partial records');
    console.log('   → Recommend deletion or quarantine\n');
  }

  const impactPercent = ((stats.total_volume / Number(totalData[0].total_volume)) * 100).toFixed(1);
  if (Number(impactPercent) > 20) {
    console.log(`🚨 HIGH IMPACT: Empty CID trades represent ${impactPercent}% of total volume`);
    console.log('   Cannot ignore - must resolve before accurate PnL calculation\n');
  } else {
    console.log(`ℹ️  MEDIUM IMPACT: Empty CID trades represent ${impactPercent}% of total volume`);
    console.log('   Can potentially exclude from PnL if unable to resolve\n');
  }

  return {
    emptyTrades: stats.total_trades,
    emptyVolume: stats.total_volume,
    percentOfTotal: Number(impactPercent),
    walletAddressConsistent: walletAddresses.length === 1,
    coreFieldsComplete: fieldsComplete
  };
}

investigateEmptyConditionIDs().catch(console.error);
