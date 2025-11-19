import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Position {
  condition_id: string;
  outcome_index: number;
  shares: number;
  total_cost: number;
  avg_price: number;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('UNREALIZED P&L (Mark-to-Market)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Methodology:');
  console.log('   1. Calculate open positions (shares held)');
  console.log('   2. Get current market price for each position');
  console.log('   3. Unrealized P&L = (current price × shares) - cost basis\n');

  // Get all trades and calculate positions
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        timestamp,
        trade_direction,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(usd_value) as usd_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow'
  });

  const trades: any[] = await tradesQuery.json();
  console.log(`Processing ${trades.length} trades...\n`);

  // Track positions
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const key = `${trade.condition_id_norm}_${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: trade.condition_id_norm,
        outcome_index: trade.outcome_index,
        shares: 0,
        total_cost: 0,
        avg_price: 0
      });
    }

    const pos = positions.get(key)!;

    if (trade.trade_direction === 'BUY') {
      pos.shares += trade.shares;
      pos.total_cost += trade.usd_value;
      pos.avg_price = pos.shares > 0 ? pos.total_cost / pos.shares : 0;
    } else if (trade.trade_direction === 'SELL') {
      const shares_to_sell = Math.min(trade.shares, Math.max(0, pos.shares));

      if (shares_to_sell > 0) {
        const cost_basis = pos.avg_price * shares_to_sell;
        pos.shares -= shares_to_sell;
        pos.total_cost -= cost_basis;
        pos.avg_price = pos.shares > 0 ? pos.total_cost / pos.shares : 0;
      }
    }
  }

  // Filter to open positions
  const openPositions = Array.from(positions.values()).filter(p => p.shares > 10);

  console.log(`Found ${openPositions.length} open positions\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('GET CURRENT MARKET PRICES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // For each position, get the most recent trade price as current price
  let totalUnrealizedPnL = 0;
  let totalInvested = 0;
  let totalCurrentValue = 0;

  console.log('Sample of top 10 positions:\n');

  const sortedPositions = openPositions.sort((a, b) => b.total_cost - a.total_cost);

  for (let i = 0; i < Math.min(10, sortedPositions.length); i++) {
    const pos = sortedPositions[i];

    // Get most recent price for this position
    const priceQuery = await clickhouse.query({
      query: `
        SELECT
          toFloat64(entry_price) as last_price,
          timestamp
        FROM default.vw_trades_canonical
        WHERE condition_id_norm = '${pos.condition_id}'
          AND outcome_index = ${pos.outcome_index}
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const priceData = await priceQuery.json();
    const currentPrice = priceData.length > 0 ? priceData[0].last_price : pos.avg_price;

    const currentValue = pos.shares * currentPrice;
    const unrealizedPnL = currentValue - pos.total_cost;

    console.log(`${i + 1}. Position:`);
    console.log(`   Condition: ${pos.condition_id.substring(0, 30)}...`);
    console.log(`   Outcome: ${pos.outcome_index}`);
    console.log(`   Shares: ${pos.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`   Avg cost: $${pos.avg_price.toFixed(4)}`);
    console.log(`   Current price: $${currentPrice.toFixed(4)}`);
    console.log(`   Cost basis: $${pos.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Current value: $${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Unrealized P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  // Calculate for all positions
  for (const pos of openPositions) {
    const priceQuery = await clickhouse.query({
      query: `
        SELECT
          toFloat64(entry_price) as last_price
        FROM default.vw_trades_canonical
        WHERE condition_id_norm = '${pos.condition_id}'
          AND outcome_index = ${pos.outcome_index}
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const priceData = await priceQuery.json();
    const currentPrice = priceData.length > 0 ? priceData[0].last_price : pos.avg_price;

    const currentValue = pos.shares * currentPrice;
    const unrealizedPnL = currentValue - pos.total_cost;

    totalInvested += pos.total_cost;
    totalCurrentValue += currentValue;
    totalUnrealizedPnL += unrealizedPnL;
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL UNREALIZED P&L');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total positions: ${openPositions.length}`);
  console.log(`Total invested: $${totalInvested.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Current value: $${totalCurrentValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Unrealized P&L: ${totalUnrealizedPnL >= 0 ? '+' : ''}$${totalUnrealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  const returnPercent = totalInvested > 0 ? (totalUnrealizedPnL / totalInvested) * 100 : 0;
  console.log(`Return: ${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000`);
  console.log(`Our unrealized P&L: $${Math.round(totalUnrealizedPnL).toLocaleString()}`);
  console.log(`Difference: $${Math.abs(80000 - totalUnrealizedPnL).toLocaleString()}\n`);

  if (Math.abs(totalUnrealizedPnL - 80000) < 10000) {
    console.log('✅ MATCH! Dune is likely using unrealized/mark-to-market P&L');
  } else if (Math.abs(totalUnrealizedPnL - 80000) < 30000) {
    console.log('🟡 CLOSE! Dune may be using unrealized P&L with slight differences in:');
    console.log('   - Price source (last trade vs current order book)');
    console.log('   - Time snapshot (different date/time)');
    console.log('   - Fee treatment');
  } else {
    console.log('❌ Still different. Dune may be using:');
    console.log('   - Complete historical data (pre-Aug 2024)');
    console.log('   - Different calculation methodology');
    console.log('   - Additional data sources');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
