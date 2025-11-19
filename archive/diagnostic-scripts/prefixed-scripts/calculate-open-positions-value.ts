import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OPEN POSITIONS & RESOLUTION VALUE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get all trades and calculate open positions
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
  const positions = new Map();

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

    const pos = positions.get(key);

    if (trade.trade_direction === 'BUY') {
      pos.shares += trade.shares;
      pos.total_cost += trade.usd_value;
      pos.avg_price = pos.shares > 0 ? pos.total_cost / pos.shares : 0;
    } else if (trade.trade_direction === 'SELL') {
      // Reduce position
      const cost_basis = pos.avg_price * trade.shares;
      pos.shares -= trade.shares;
      pos.total_cost -= cost_basis;
      pos.avg_price = pos.shares > 0 ? pos.total_cost / pos.shares : 0;
    }
  }

  // Filter to open positions only
  const openPositions = Array.from(positions.values()).filter(p => p.shares > 10);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OPEN POSITIONS (> 10 shares)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total open positions: ${openPositions.length}\n`);

  let totalInvested = 0;
  let totalShares = 0;

  openPositions.sort((a, b) => b.total_cost - a.total_cost).slice(0, 20).forEach((pos, i) => {
    console.log(`${i + 1}. Condition: ${pos.condition_id.substring(0, 30)}...`);
    console.log(`   Outcome: ${pos.outcome_index}`);
    console.log(`   Shares: ${pos.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`   Avg cost: $${pos.avg_price.toFixed(4)}`);
    console.log(`   Invested: $${pos.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   If WINS: $${pos.shares.toLocaleString('en-US', { minimumFractionDigits: 2 })} (resolve to $1/share)`);
    console.log(`   If LOSES: $0 (resolve to $0/share)`);
    console.log(`   Potential P&L: -$${pos.total_cost.toFixed(2)} to +$${(pos.shares - pos.total_cost).toFixed(2)}\n`);

    totalInvested += pos.total_cost;
    totalShares += pos.shares;
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL OPEN POSITIONS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Calculate for ALL open positions
  openPositions.forEach(pos => {
    totalInvested += pos.total_cost;
    totalShares += pos.shares;
  });

  console.log(`Total positions: ${openPositions.length}`);
  console.log(`Total invested: $${totalInvested.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total shares: ${totalShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('RESOLUTION VALUE SCENARIOS:\n');

  console.log('1. ALL positions LOSE (resolve to $0):');
  console.log(`   Payout: $0`);
  console.log(`   P&L: -$${totalInvested.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('2. ALL positions WIN (resolve to $1/share):');
  console.log(`   Payout: $${totalShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   P&L: +$${(totalShares - totalInvested).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('3. MIXED (50/50):');
  const halfPayout = totalShares * 0.5;
  console.log(`   Payout: ~$${halfPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   P&L: ~$${(halfPayout - totalInvested).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Dune reported: ~$80,000 realized P&L\n');

  console.log('Our analysis:');
  console.log(`   - Old positions closed: Unknown P&L (data before 2024-08-21)`);
  console.log(`   - New positions open: $${totalInvested.toLocaleString()} invested`);
  console.log(`   - Resolution value range: -$${totalInvested.toLocaleString()} to +$${(totalShares - totalInvested).toLocaleString()}`);
  console.log(`   - 50/50 scenario: ~$${(halfPayout - totalInvested).toLocaleString()}\n`);

  const breakEvenPercent = (totalInvested / totalShares) * 100;
  console.log(`Need ${breakEvenPercent.toFixed(1)}% of positions to WIN to break even\n`);

  if (halfPayout - totalInvested > 70000 && halfPayout - totalInvested < 90000) {
    console.log('✅ 50/50 scenario ($' + (halfPayout - totalInvested).toFixed(0) + ') is VERY CLOSE to Dune\'s $80K!');
    console.log('   This suggests Dune includes unrealized/resolution value!\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
