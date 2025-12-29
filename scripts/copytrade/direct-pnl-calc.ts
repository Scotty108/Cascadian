/**
 * Direct PnL calculation using CLOB + CTF events
 * No condition_id mapping needed!
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DIRECT PnL CALCULATION (NO CONDITION MAPPING NEEDED) ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  // SAFEGUARD: Check token mapping coverage first
  console.log('0. SAFEGUARD: Checking token mapping coverage...');
  const coverageQ = `
    WITH tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
    )
    SELECT
      count() as total,
      countIf(m.token_id_dec IS NOT NULL) as mapped_v5,
      countIf(p.token_id_dec IS NOT NULL) as mapped_patch,
      countIf(m.token_id_dec IS NULL AND p.token_id_dec IS NULL) as unmapped
    FROM tokens t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_token_to_condition_patch p ON t.token_id = p.token_id_dec
  `;
  const coverageR = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
  const coverage = (await coverageR.json())[0] as {
    total: number;
    mapped_v5: number;
    mapped_patch: number;
    unmapped: number;
  };

  const mappingPct = ((coverage.total - coverage.unmapped) / coverage.total) * 100;
  console.log(`   Total tokens: ${coverage.total}`);
  console.log(`   Mapped (v5): ${coverage.mapped_v5}`);
  console.log(`   Mapped (patch): ${coverage.mapped_patch}`);
  console.log(`   Unmapped: ${coverage.unmapped}`);
  console.log(`   Coverage: ${mappingPct.toFixed(1)}%`);

  if (coverage.unmapped > 0) {
    console.log(`\n   ⚠️  WARNING: ${coverage.unmapped}/${coverage.total} tokens are UNMAPPED!`);
    console.log('   This means we cannot calculate resolution-based PnL for these tokens.');
    console.log('   Proceeding with CLOB + CTF calculation...\n');
  }

  // Step 1: CLOB trades summary
  console.log('1. CLOB trades summary...');
  const q1 = `
    WITH dedup AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as total_buys,
      sum(if(side = 'sell', usdc, 0)) as total_sells,
      sum(if(side = 'buy', tokens, 0)) as tokens_bought,
      sum(if(side = 'sell', tokens, 0)) as tokens_sold,
      count() as num_trades
    FROM dedup
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const clobData = (await r1.json())[0] as {
    total_buys: string;
    total_sells: string;
    tokens_bought: string;
    tokens_sold: string;
    num_trades: string;
  };
  const totalBuys = parseFloat(clobData.total_buys);
  const totalSells = parseFloat(clobData.total_sells);
  const tokensBought = parseFloat(clobData.tokens_bought);
  const tokensSold = parseFloat(clobData.tokens_sold);

  console.log(`   Buys: $${totalBuys.toFixed(2)} for ${tokensBought.toFixed(2)} tokens`);
  console.log(`   Sells: $${totalSells.toFixed(2)} for ${tokensSold.toFixed(2)} tokens`);
  console.log(`   Num trades: ${clobData.num_trades}`);
  console.log(`   Net tokens: ${(tokensBought - tokensSold).toFixed(2)} (positive = held)`);

  // Step 2: CTF redemptions
  console.log('\n2. CTF redemptions...');
  const q2 = `
    SELECT
      sum(toFloat64(amount_or_payout)) / 1e6 as total_redemptions,
      count() as num_redemptions
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND event_type = 'PayoutRedemption'
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const ctfData = (await r2.json())[0] as {
    total_redemptions: string;
    num_redemptions: string;
  };
  const totalRedemptions = parseFloat(ctfData.total_redemptions);
  console.log(
    `   Total redemptions: $${totalRedemptions.toFixed(2)} from ${ctfData.num_redemptions} payouts`
  );

  // Step 3: Calculate PnL components
  console.log('\n3. PnL Calculation...');
  const tokenDeficit = Math.max(0, tokensSold - tokensBought);
  const tokenSurplus = Math.max(0, tokensBought - tokensSold);

  console.log(
    `   Token deficit (sold > bought): ${tokenDeficit.toFixed(2)} tokens (from splits, cost $1 each)`
  );
  console.log(`   Token surplus (bought > sold): ${tokenSurplus.toFixed(2)} tokens (held)`);

  // Realized PnL = Sells - Buys + Redemptions - SplitCosts
  const realizedPnL = totalSells - totalBuys + totalRedemptions - tokenDeficit;
  console.log('\n   Realized PnL calculation:');
  console.log(`     Sells: +$${totalSells.toFixed(2)}`);
  console.log(`     Buys: -$${totalBuys.toFixed(2)}`);
  console.log(`     Redemptions: +$${totalRedemptions.toFixed(2)}`);
  console.log(`     Split costs: -$${tokenDeficit.toFixed(2)}`);
  console.log(`     = $${realizedPnL.toFixed(2)}`);

  // Compare to ground truth
  console.log('\n4. Ground Truth Comparison...');
  console.log('   Expected Total PnL: -$86.66');
  console.log(`   Our Realized PnL: $${realizedPnL.toFixed(2)}`);

  const gap = -86.66 - realizedPnL;
  console.log(`   Gap: $${gap.toFixed(2)}`);

  if (tokenSurplus > 0) {
    const impliedAvgPrice = Math.abs(gap) / tokenSurplus;
    console.log(`\n   Token surplus: ${tokenSurplus.toFixed(2)} tokens`);
    console.log(`   Implied avg price per token: $${impliedAvgPrice.toFixed(4)}`);
  }

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
