import { clickhouse } from './lib/clickhouse/client';

interface DuplicateTrade {
  transaction_hash: string;
  occurrence_count: number;
  trade_ids: string[];
  directions: string[];
  shares_values: number[];
  usd_values: number[];
}

interface ScalingCheck {
  trade_id: string;
  transaction_hash: string;
  trade_direction: string;
  shares: number;
  price: number;
  usd_value: number;
  calculated_value: number;
  value_discrepancy: number;
  validation_status: string;
}

interface AggregateMetrics {
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  total_bought: number;
  total_sold: number;
  net_shares: number;
  total_cost: number;
  total_proceeds: number;
  realized_pnl: number;
}

interface SourceComparison {
  source: string;
  fill_count?: number;
  trade_count?: number;
  total_shares: number;
  total_value: number;
}

const XI_CONDITION_ID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateXiMarket() {
  console.log('=== XI JINPING MARKET INVESTIGATION ===\n');
  console.log(`Wallet: ${XCNSTRATEGY_WALLET}`);
  console.log(`Condition ID: ${XI_CONDITION_ID}\n`);

  const results: any = {};

  // 1A: Check for duplicate trades
  console.log('1A. Checking for duplicate trades...');
  const duplicatesResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        count() AS occurrence_count,
        groupArray(trade_id) AS trade_ids,
        groupArray(trade_direction) AS directions,
        groupArray(shares) AS shares_values,
        groupArray(usd_value) AS usd_values
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
        AND condition_id_norm_v3 = {condition_id:String}
      GROUP BY transaction_hash
      HAVING occurrence_count > 1
      ORDER BY occurrence_count DESC
    `,
    query_params: {
      wallet: XCNSTRATEGY_WALLET.toLowerCase(),
      condition_id: XI_CONDITION_ID
    },
    format: 'JSONEachRow'
  });

  const duplicates = await duplicatesResult.json<DuplicateTrade>();
  results.duplicates = duplicates;
  console.log(`   Found ${duplicates.length} duplicate transactions`);

  if (duplicates.length > 0) {
    console.log('   Sample duplicates:');
    duplicates.slice(0, 3).forEach(dup => {
      console.log(`   - TX: ${dup.transaction_hash.substring(0, 10)}...`);
      console.log(`     Occurrences: ${dup.occurrence_count}`);
      console.log(`     Directions: ${dup.directions.join(', ')}`);
      console.log(`     USD Values: ${dup.usd_values.map(v => '$' + v.toFixed(2)).join(', ')}`);
    });

    const totalDuplicateValue = duplicates.reduce((sum, dup) =>
      sum + dup.usd_values.reduce((s, v) => s + v, 0), 0
    );
    console.log(`   Total duplicate value: $${totalDuplicateValue.toFixed(2)}`);
  }
  console.log();

  // 1B: Check for scaling issues
  console.log('1B. Checking for scaling issues (shares × price vs usd_value)...');
  const scalingResult = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        transaction_hash,
        trade_direction,
        shares,
        price,
        usd_value,
        shares * price AS calculated_value,
        abs(usd_value - (shares * price)) AS value_discrepancy,
        CASE
          WHEN abs(usd_value - (shares * price)) > usd_value * 0.01 THEN 'MISMATCH'
          ELSE 'OK'
        END AS validation_status
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
        AND condition_id_norm_v3 = {condition_id:String}
      ORDER BY value_discrepancy DESC
      LIMIT 20
    `,
    query_params: {
      wallet: XCNSTRATEGY_WALLET.toLowerCase(),
      condition_id: XI_CONDITION_ID
    },
    format: 'JSONEachRow'
  });

  const scalingChecks = await scalingResult.json<ScalingCheck>();
  results.scaling = scalingChecks;

  const mismatches = scalingChecks.filter(t => t.validation_status === 'MISMATCH');
  console.log(`   Analyzed ${scalingChecks.length} trades`);
  console.log(`   Scaling mismatches: ${mismatches.length}`);

  if (mismatches.length > 0) {
    console.log('   Top mismatches:');
    mismatches.slice(0, 5).forEach(m => {
      console.log(`   - Trade: ${m.trade_id}`);
      console.log(`     Shares: ${m.shares}, Price: ${m.price}`);
      console.log(`     Calculated: $${m.calculated_value.toFixed(2)}, Actual: $${m.usd_value.toFixed(2)}`);
      console.log(`     Discrepancy: $${m.value_discrepancy.toFixed(2)}`);
    });
  }
  console.log();

  // 1D: Aggregate analysis
  console.log('1D. Aggregate cost/shares/PnL analysis...');
  const aggregateResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        countIf(trade_direction = 'BUY') AS buy_trades,
        countIf(trade_direction = 'SELL') AS sell_trades,
        sumIf(shares, trade_direction = 'BUY') AS total_bought,
        sumIf(shares, trade_direction = 'SELL') AS total_sold,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(usd_value, trade_direction = 'BUY') AS total_cost,
        sumIf(usd_value, trade_direction = 'SELL') AS total_proceeds,
        sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS realized_pnl
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
        AND condition_id_norm_v3 = {condition_id:String}
    `,
    query_params: {
      wallet: XCNSTRATEGY_WALLET.toLowerCase(),
      condition_id: XI_CONDITION_ID
    },
    format: 'JSONEachRow'
  });

  const aggregateData = await aggregateResult.json<AggregateMetrics>();
  const aggregate = aggregateData[0];
  results.aggregate = aggregate;

  console.log('   Aggregate Metrics:');
  console.log(`   Total Trades: ${aggregate.total_trades}`);
  console.log(`   Buy Trades: ${aggregate.buy_trades} | Sell Trades: ${aggregate.sell_trades}`);
  console.log(`   Total Bought: ${aggregate.total_bought.toFixed(2)} shares`);
  console.log(`   Total Sold: ${aggregate.total_sold.toFixed(2)} shares`);
  console.log(`   Net Shares: ${aggregate.net_shares.toFixed(2)}`);
  console.log(`   Total Cost: $${aggregate.total_cost.toFixed(2)}`);
  console.log(`   Total Proceeds: $${aggregate.total_proceeds.toFixed(2)}`);
  console.log(`   Realized P&L: $${aggregate.realized_pnl.toFixed(2)}`);

  // Check for anomalies
  const anomalies = [];
  if (aggregate.total_cost > 1000000) {
    anomalies.push(`Cost exceeds $1M: $${aggregate.total_cost.toFixed(2)}`);
  }
  if (Math.abs(aggregate.net_shares) > 100000) {
    anomalies.push(`Net shares exceed 100k: ${aggregate.net_shares.toFixed(2)}`);
  }
  if (Math.abs(aggregate.realized_pnl) > 500000) {
    anomalies.push(`P&L exceeds $500k: $${aggregate.realized_pnl.toFixed(2)}`);
  }

  if (anomalies.length > 0) {
    console.log('\n   ⚠️  ANOMALIES DETECTED:');
    anomalies.forEach(a => console.log(`   - ${a}`));
  }
  console.log();

  // 1E: Compare with source data
  console.log('1E. Comparing with clob_fills source data...');
  const comparisonResult = await clickhouse.query({
    query: `
      SELECT
        'clob_fills' AS source,
        count() AS fill_count,
        sum(size / 1000000.0) AS total_shares,
        sum(size / 1000000.0 * price) AS total_value
      FROM clob_fills cf
      LEFT JOIN wallet_identity_map wim
        ON lower(cf.proxy_wallet) = lower(wim.proxy_wallet)
      WHERE (
          lower(cf.proxy_wallet) = {wallet:String}
          OR lower(wim.canonical_wallet) = {wallet:String}
        )
        AND cf.condition_id = {condition_id:String}

      UNION ALL

      SELECT
        'pm_trades_canonical_v3' AS source,
        count() AS trade_count,
        sum(shares) AS total_shares,
        sum(usd_value) AS total_value
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = {wallet:String}
        AND condition_id_norm_v3 = {condition_id:String}
    `,
    query_params: {
      wallet: XCNSTRATEGY_WALLET.toLowerCase(),
      condition_id: XI_CONDITION_ID
    },
    format: 'JSONEachRow'
  });

  const comparison = await comparisonResult.json<SourceComparison>();
  results.comparison = comparison;

  console.log('   Source Comparison:');
  comparison.forEach(src => {
    console.log(`   ${src.source}:`);
    console.log(`     Count: ${src.fill_count || src.trade_count}`);
    console.log(`     Total Shares: ${src.total_shares.toFixed(2)}`);
    console.log(`     Total Value: $${src.total_value.toFixed(2)}`);
  });

  if (comparison.length === 2) {
    const clob = comparison.find(c => c.source === 'clob_fills');
    const canonical = comparison.find(c => c.source === 'pm_trades_canonical_v3');

    if (clob && canonical) {
      const valueDiff = Math.abs(clob.total_value - canonical.total_value);
      const valueDiscrepancy = (valueDiff / clob.total_value) * 100;

      console.log('\n   Discrepancy Analysis:');
      console.log(`   Value difference: $${valueDiff.toFixed(2)}`);
      console.log(`   Percentage discrepancy: ${valueDiscrepancy.toFixed(2)}%`);

      if (valueDiscrepancy > 5) {
        console.log('   ⚠️  SIGNIFICANT DISCREPANCY (>5%) between sources!');
      }
    }
  }
  console.log();

  // Summary
  console.log('=== INVESTIGATION SUMMARY ===');
  console.log(`Duplicates: ${duplicates.length} transactions`);
  console.log(`Scaling Mismatches: ${mismatches.length} trades`);
  console.log(`Anomalies: ${anomalies.length}`);
  console.log(`Total Cost: $${aggregate.total_cost.toFixed(2)}`);

  if (aggregate.total_cost > 100000) {
    console.log('\n🚨 ROOT CAUSE LIKELY: Duplicate trades or incorrect aggregation');
  }

  return results;
}

// Run investigation
investigateXiMarket()
  .then(results => {
    console.log('\n✅ Investigation complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  });
