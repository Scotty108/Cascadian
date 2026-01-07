import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function manualPnL(wallet: string) {
  console.log('ANALYZING WALLET:', wallet);
  console.log('='.repeat(90));

  // Get all trades with condition mapping
  const q = `
    SELECT
      m.condition_id,
      m.question,
      t.side,
      sum(t.usdc_amount) / 1e6 as usdc,
      sum(t.token_amount) / 1e6 as tokens
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
      AND t.is_deleted = 0
    GROUP BY m.condition_id, m.question, t.side
    ORDER BY m.condition_id, t.side
  `;

  const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await res.json()) as any[];

  // Group by condition
  const conditions = new Map<
    string,
    { question: string; buys: number; sells: number; buyTokens: number; sellTokens: number }
  >();

  for (const r of rows) {
    if (!conditions.has(r.condition_id)) {
      conditions.set(r.condition_id, { question: r.question, buys: 0, sells: 0, buyTokens: 0, sellTokens: 0 });
    }
    const c = conditions.get(r.condition_id)!;
    if (r.side === 'buy') {
      c.buys += r.usdc;
      c.buyTokens += r.tokens;
    } else {
      c.sells += r.usdc;
      c.sellTokens += r.tokens;
    }
  }

  // Check resolutions
  const conditionIds = Array.from(conditions.keys());
  if (conditionIds.length === 0) {
    console.log('No positions found for this wallet');
    return;
  }

  const resQ = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id IN ('${conditionIds.join("','")}')
  `;
  const resRes = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = new Map((await resRes.json() as any[]).map((r) => [r.condition_id, r.payout_numerators]));

  let totalCost = 0;
  let totalSold = 0;
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;
  let unresolvedValue = 0;

  console.log('');
  console.log('Question                                   | Cost      | Sold      | Shares  | Status | PnL');
  console.log('-'.repeat(100));

  for (const [cid, c] of conditions) {
    const cost = c.buys;
    const sold = c.sells;
    const shares = c.buyTokens - c.sellTokens;
    const resolution = resolutions.get(cid);

    totalCost += cost;
    totalSold += sold;

    let pnl = 0;
    let status = 'OPEN';

    if (resolution) {
      // Parse payout - assume binary, outcome 0 (YES)
      const payouts = JSON.parse(resolution);
      const payout = shares * (payouts[0] === 1 ? 1 : 0);
      pnl = sold + payout - cost;
      status = pnl > 0 ? 'WIN' : 'LOSS';

      if (pnl > 0) wins++;
      else losses++;

      totalPnL += pnl;
    } else {
      // Unrealized - estimate at 50% for now
      unresolvedValue += shares * 0.5;
    }

    const shortQ = (c.question || 'Unknown').slice(0, 40);
    console.log(
      `${shortQ.padEnd(42)} | $${cost.toFixed(0).padStart(8)} | $${sold.toFixed(0).padStart(8)} | ${shares.toFixed(0).padStart(7)} | ${status.padEnd(4)} | $${pnl.toFixed(0)}`
    );
  }

  console.log('='.repeat(100));
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Total Cost:       $' + totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 }));
  console.log('Total Sold:       $' + totalSold.toLocaleString(undefined, { minimumFractionDigits: 2 }));
  console.log('Realized PnL:     $' + totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 }));
  console.log('Unrealized Est:   $' + unresolvedValue.toLocaleString(undefined, { minimumFractionDigits: 2 }));
  console.log('');
  console.log('Wins / Losses:    ' + wins + ' / ' + losses);
  console.log('Win Rate:         ' + ((wins / (wins + losses || 1)) * 100).toFixed(1) + '%');
  console.log('ROI:              ' + ((totalPnL / totalCost) * 100).toFixed(2) + '%');
  console.log('Avg Position:     $' + (totalCost / conditions.size).toFixed(0));
}

const wallet = process.argv[2] || '0x282aa94cc5751f08dfb9be98fecbae84b7e19bce';
manualPnL(wallet).catch(console.error);
