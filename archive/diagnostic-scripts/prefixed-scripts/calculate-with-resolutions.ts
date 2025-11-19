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
  explicit_realized_pnl: number; // From explicit SELL trades
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L WITH RESOLUTION VALUE (Correct Methodology)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Methodology:');
  console.log('   1. Explicit SELLs = realized at sale price');
  console.log('   2. Positions held to resolution = realized at $1 (win) or $0 (lose)');
  console.log('   3. Total realized P&L = explicit sales + resolution value\n');

  // Get all trades
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

  // Process all trades
  for (const trade of trades) {
    const key = `${trade.condition_id_norm}_${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: trade.condition_id_norm,
        outcome_index: trade.outcome_index,
        shares: 0,
        total_cost: 0,
        avg_price: 0,
        explicit_realized_pnl: 0
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
        // Calculate realized P&L for explicit sale
        const cost_basis = pos.avg_price * shares_to_sell;
        const sale_proceeds = (trade.usd_value / trade.shares) * shares_to_sell;
        pos.explicit_realized_pnl += (sale_proceeds - cost_basis);

        // Update position
        pos.shares -= shares_to_sell;
        pos.total_cost -= cost_basis;
        pos.avg_price = pos.shares > 0 ? pos.total_cost / pos.shares : 0;
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 1: EXPLICIT SALES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let total_explicit_realized = 0;
  for (const [key, pos] of positions) {
    if (pos.explicit_realized_pnl !== 0) {
      total_explicit_realized += pos.explicit_realized_pnl;
    }
  }

  console.log(`Total explicit realized P&L: $${total_explicit_realized.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 2: CHECK RESOLUTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get resolution data
  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_outcome,
        resolved_at
      FROM default.market_resolutions_final
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });

  const resolutions = await resolutionsQuery.json();
  const resolutionMap = new Map<string, { winning_outcome: number; resolved_at: string }>();

  for (const res of resolutions) {
    resolutionMap.set(res.condition_id_norm, {
      winning_outcome: res.winning_outcome,
      resolved_at: res.resolved_at
    });
  }

  console.log(`Found ${resolutionMap.size} resolved markets\n`);

  // Calculate resolution P&L
  let total_resolution_pnl = 0;
  let resolved_positions = 0;
  let won_positions = 0;
  let lost_positions = 0;
  let total_shares_resolved = 0;

  console.log('Positions held to resolution:\n');

  for (const [key, pos] of positions) {
    if (pos.shares > 10) { // Only count significant positions
      const resolution = resolutionMap.get(pos.condition_id);

      if (resolution) {
        resolved_positions++;
        total_shares_resolved += pos.shares;

        const won = resolution.winning_outcome === pos.outcome_index;
        const resolution_value = won ? pos.shares * 1.0 : 0;
        const resolution_pnl = resolution_value - pos.total_cost;
        total_resolution_pnl += resolution_pnl;

        if (won) {
          won_positions++;
          console.log(`✅ WON: ${pos.shares.toFixed(2)} shares @ $${pos.avg_price.toFixed(4)}`);
          console.log(`   Cost: $${pos.total_cost.toFixed(2)}`);
          console.log(`   Resolution value: $${resolution_value.toFixed(2)}`);
          console.log(`   P&L: +$${resolution_pnl.toFixed(2)}\n`);
        } else {
          lost_positions++;
          console.log(`❌ LOST: ${pos.shares.toFixed(2)} shares @ $${pos.avg_price.toFixed(4)}`);
          console.log(`   Cost: $${pos.total_cost.toFixed(2)}`);
          console.log(`   Resolution value: $0.00`);
          console.log(`   P&L: -$${pos.total_cost.toFixed(2)}\n`);
        }
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESOLUTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Resolved positions: ${resolved_positions}`);
  console.log(`   Won: ${won_positions}`);
  console.log(`   Lost: ${lost_positions}`);
  console.log(`   Win rate: ${resolved_positions > 0 ? (won_positions / resolved_positions * 100).toFixed(1) : 0}%`);
  console.log(`Total shares resolved: ${total_shares_resolved.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`Total resolution P&L: $${total_resolution_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL REALIZED P&L (CORRECT CALCULATION)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const total_realized_pnl = total_explicit_realized + total_resolution_pnl;

  console.log('Components:');
  console.log(`   Explicit sales: $${total_explicit_realized.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   Resolution value: $${total_resolution_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   ───────────────────────────────────────`);
  console.log(`   TOTAL REALIZED: $${total_realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000`);
  console.log(`Our calculation: $${total_realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Difference: $${(80000 - total_realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  if (Math.abs(total_realized_pnl - 80000) < 10000) {
    console.log('✅ VERY CLOSE! Within $10K of Dune\'s reported value');
  } else if (Math.abs(total_realized_pnl - 80000) < 30000) {
    console.log('🟡 GETTING CLOSER. Within $30K of Dune\'s reported value');
  } else {
    console.log('❌ Still significant gap. Need to investigate further.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
