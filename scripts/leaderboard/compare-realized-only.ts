/**
 * Compare REALIZED-ONLY PnL across formulas
 * This removes the mark-to-market price difference for unresolved positions
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface Resolution {
  resolved: boolean;
  payout: number;
}

const resolutionCache = new Map<string, Resolution>();

async function loadResolutions() {
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
  console.log(`Loaded ${resolutionCache.size} resolutions\n`);
}

async function calcV12Realized(wallet: string): Promise<number> {
  const q = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const positions = (await r.json()) as any[];

  let realizedPnl = 0;
  for (const pos of positions) {
    const res = resolutionCache.get(pos.token_id);
    if (res?.resolved) {
      realizedPnl += Number(pos.net_cash) + Number(pos.net_tokens) * res.payout;
    }
  }
  return realizedPnl;
}

const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', uiTotal: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', uiTotal: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', uiTotal: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', uiTotal: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', uiTotal: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', uiTotal: 37801 },
];

async function main() {
  console.log('='.repeat(90));
  console.log('REALIZED-ONLY PnL COMPARISON (V12 formula: net_cash + net_tokens × payout)');
  console.log('='.repeat(90));
  console.log('');
  console.log('Note: UI Total includes unrealized. Comparing realized-only removes mark-to-market differences.');
  console.log('');

  await loadResolutions();

  console.log('Wallet           | V12 Realized   | UI Total   | Notes');
  console.log('-'.repeat(90));

  for (const w of testWallets) {
    const realized = await calcV12Realized(w.addr);
    const diff = realized - w.uiTotal;
    const pctDiff = w.uiTotal !== 0 ? ((diff / Math.abs(w.uiTotal)) * 100).toFixed(1) : 'N/A';

    const realStr = ('$' + realized.toFixed(0)).padStart(14);
    const uiStr = ('$' + w.uiTotal).padStart(10);

    let note = '';
    if (realized > w.uiTotal && w.uiTotal > 0) {
      note = `Realized > UI Total (unrealized likely negative)`;
    } else if (realized < w.uiTotal) {
      note = `Realized < UI Total (unrealized likely positive)`;
    } else if (realized > 0 && w.uiTotal < 0) {
      note = `Sign flip - we show profit, UI shows loss`;
    } else if (realized < 0 && w.uiTotal > 0) {
      note = `Sign flip - we show loss, UI shows profit`;
    }

    console.log(`${w.name.padEnd(16)} | ${realStr} | ${uiStr} | ${note}`);
  }

  console.log('-'.repeat(90));
  console.log('');
  console.log('Key insight: If V12 Realized is close to UI Total, the formula is correct.');
  console.log('Differences are explained by unrealized positions marked at different prices.');
}

main().catch(console.error);
