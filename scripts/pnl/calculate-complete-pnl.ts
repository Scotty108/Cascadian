/**
 * Calculate Complete PnL with Resolved Position Values
 *
 * This script calculates the full PnL including:
 * 1. CLOB trading cashflows (buys/sells)
 * 2. Resolved position values (tokens on winning outcomes)
 * 3. Open position estimates
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletInfo {
  addr: string;
  label: string;
  uiPnl: number;
}

const WALLETS: WalletInfo[] = [
  {
    addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    label: 'W_22M',
    uiPnl: 22053934,
  },
  {
    addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    label: 'W_97K',
    uiPnl: 96731,
  },
  {
    addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    label: 'W_-10M',
    uiPnl: -10021172,
  },
];

async function calculateCompletePnl(wallet: string, label: string, uiPnl: number): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log(`${label}: ${wallet}`);
  console.log('═'.repeat(80));

  // Get all positions with their resolutions
  const positionsResult = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          token_id,
          sum(if(side = 'buy', tokens, 0)) as bought,
          sum(if(side = 'sell', tokens, 0)) as sold,
          sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_position,
          sum(if(side = 'buy', usdc, 0)) as cost_basis,
          sum(if(side = 'sell', usdc, 0)) as sale_proceeds
        FROM (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(token_amount) / 1e6 as tokens,
            any(usdc_amount) / 1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        p.token_id,
        p.net_position,
        p.cost_basis,
        p.sale_proceeds,
        m.condition_id,
        m.outcome_index,
        r.payout_numerators,
        r.resolved_at
      FROM positions p
      LEFT JOIN pm_token_to_condition_map_v3 m ON p.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const positions = (await positionsResult.json()) as Array<{
    token_id: string;
    net_position: number;
    cost_basis: number;
    sale_proceeds: number;
    condition_id: string | null;
    outcome_index: number | null;
    payout_numerators: string | null;
    resolved_at: string | null;
  }>;

  let totalCostBasis = 0;
  let totalSaleProceeds = 0;
  let totalResolvedValue = 0;
  let totalOpenValue = 0;
  let resolvedWinners: { token: string; value: number }[] = [];
  let resolvedLosers: { token: string; lostValue: number }[] = [];

  console.log(`\nProcessing ${positions.length} positions...`);

  for (const p of positions) {
    totalCostBasis += p.cost_basis;
    totalSaleProceeds += p.sale_proceeds;

    if (p.net_position > 0.01) {
      if (p.payout_numerators && p.resolved_at) {
        // Parse the payout_numerators string
        try {
          const payouts = JSON.parse(p.payout_numerators);
          const outcomeIndex = p.outcome_index ?? 0;
          const payoutValue = payouts[outcomeIndex] ?? 0;
          const positionValue = p.net_position * payoutValue;

          totalResolvedValue += positionValue;

          if (positionValue > 10000) {
            resolvedWinners.push({ token: p.token_id, value: positionValue });
          }
          if (positionValue === 0 && p.net_position > 10000) {
            // This is a loser - tokens on losing outcome
            resolvedLosers.push({ token: p.token_id, lostValue: p.net_position });
          }
        } catch (e) {
          // Skip parsing errors
        }
      } else if (!p.payout_numerators) {
        // Open position - not yet resolved, estimate at 50%
        totalOpenValue += p.net_position * 0.5;
      }
    }
  }

  // Sort and show top winners
  resolvedWinners.sort((a, b) => b.value - a.value);
  console.log('\nTop 5 Winning Positions:');
  for (const w of resolvedWinners.slice(0, 5)) {
    console.log(`  ${w.token.substring(0, 20)}... → $${w.value.toLocaleString()}`);
  }

  // Show losers if any significant
  resolvedLosers.sort((a, b) => b.lostValue - a.lostValue);
  if (resolvedLosers.length > 0) {
    console.log('\nTop 5 Losing Positions (tokens lost):');
    for (const l of resolvedLosers.slice(0, 5)) {
      console.log(`  ${l.token.substring(0, 20)}... → ${l.lostValue.toLocaleString()} tokens (now worth $0)`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('CALCULATION SUMMARY:');
  console.log('─'.repeat(60));
  console.log(`Total Cost Basis (USDC spent):          -$${totalCostBasis.toLocaleString()}`);
  console.log(`Total Sale Proceeds (USDC received):    +$${totalSaleProceeds.toLocaleString()}`);
  console.log(`Resolved Position Value (winners @ $1): +$${totalResolvedValue.toLocaleString()}`);
  console.log(`Open Position Value (estimate @ $0.50): +$${totalOpenValue.toLocaleString()}`);
  console.log('─'.repeat(60));

  const realizedPnl = totalSaleProceeds + totalResolvedValue - totalCostBasis;
  const totalPnl = realizedPnl + totalOpenValue;

  console.log(`\nRealized PnL:                            $${realizedPnl.toLocaleString()}`);
  console.log(`Total PnL (incl. open estimates):        $${totalPnl.toLocaleString()}`);
  console.log('');
  console.log(`UI PnL:                                  $${uiPnl.toLocaleString()}`);
  console.log(`Difference (Realized vs UI):             $${(uiPnl - realizedPnl).toLocaleString()}`);
  console.log(`Difference (Total vs UI):                $${(uiPnl - totalPnl).toLocaleString()}`);
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('COMPLETE PnL CALCULATION WITH RESOLVED POSITIONS');
  console.log('═'.repeat(80));

  for (const w of WALLETS) {
    await calculateCompletePnl(w.addr, w.label, w.uiPnl);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(80));
}

main().catch(console.error);
