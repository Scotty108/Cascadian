/**
 * CCR-v2: Fixed calculation that handles short positions correctly
 *
 * The issue with CCR-v1 position protection:
 * - It ignores sells when pos.amount = 0 (no prior buy)
 * - But short selling (selling without buying) IS a real position with P&L impact
 *
 * Correct formula (V12-style):
 * PnL = net_cash_flow + net_tokens * resolution_price
 *
 * Where:
 * - net_cash_flow = sum(sell_usdc) - sum(buy_usdc)
 * - net_tokens = sum(buy_tokens) - sum(sell_tokens)
 * - resolution_price = 1.0 if won, 0.0 if lost, 0.5 if unresolved
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface Resolution {
  resolved: boolean;
  payout: number;
}

const resolutionCache = new Map<string, Resolution>();

async function loadAllResolutions(): Promise<void> {
  if (resolutionCache.size > 0) return;

  const mapQ = `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5`;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      condition_id: m.condition_id.toLowerCase(),
      outcome_index: parseInt(m.outcome_index),
    });
  }

  const resQ = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];

  const conditionResolutions = new Map<string, number[]>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      conditionResolutions.set(r.condition_id.toLowerCase(), payouts);
    } catch {}
  }

  for (const [tokenId, mapping] of tokenToCondition) {
    const payouts = conditionResolutions.get(mapping.condition_id);
    if (payouts && payouts.length > mapping.outcome_index) {
      resolutionCache.set(tokenId, {
        resolved: true,
        payout: payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0,
      });
    } else {
      resolutionCache.set(tokenId, { resolved: false, payout: 0 });
    }
  }
  console.log(`Loaded ${resolutionCache.size} token resolutions\n`);
}

async function calcCCR2PnL(wallet: string): Promise<{
  realized_pnl: number;
  unrealized_pnl: number;
  trade_count: number;
}> {
  // CCR-v2: Simple aggregation per token, then apply resolution
  const q = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) / 1e6 as net_cash,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) / 1e6 as net_tokens
    FROM (
      SELECT
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const positions = (await r.json()) as any[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;

  for (const pos of positions) {
    const tokenId = pos.token_id;
    const netCash = Number(pos.net_cash);
    const netTokens = Number(pos.net_tokens);

    const res = resolutionCache.get(tokenId);
    if (res?.resolved) {
      // Realized = cash flow + tokens * payout
      realizedPnl += netCash + netTokens * res.payout;
    } else {
      // Unrealized = cash flow + tokens * 0.5 (mark-to-market)
      unrealizedPnl += netCash + netTokens * 0.5;
    }
  }

  return {
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    trade_count: positions.length,
  };
}

const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(80));
  console.log('TESTING CCR-v2 (V12-style: net_cash + net_tokens * resolution)');
  console.log('='.repeat(80));

  await loadAllResolutions();

  console.log('Wallet           | CCR-v2 Realized | Unrealized | Total     | UI Total   | Diff');
  console.log('-'.repeat(95));

  for (const w of testWallets) {
    const pnl = await calcCCR2PnL(w.addr);
    const total = pnl.realized_pnl + pnl.unrealized_pnl;
    const diff = total - w.ui;
    const pctDiff = w.ui !== 0 ? ((diff / Math.abs(w.ui)) * 100).toFixed(1) : 'N/A';

    const ccr2Str = ('$' + pnl.realized_pnl.toFixed(0)).padStart(15);
    const unrealStr = ('$' + pnl.unrealized_pnl.toFixed(0)).padStart(10);
    const totalStr = ('$' + total.toFixed(0)).padStart(9);
    const uiStr = ('$' + w.ui.toFixed(0)).padStart(10);
    const diffStr = ('$' + diff.toFixed(0)).padStart(8);

    console.log(`${w.name.padEnd(16)} | ${ccr2Str} | ${unrealStr} | ${totalStr} | ${uiStr} | ${diffStr} (${pctDiff}%)`);
  }

  console.log('-'.repeat(95));
  console.log('NOTE: CCR-v2 uses V12-style formula: net_cash + net_tokens * resolution_price');
}

main().catch(console.error);
