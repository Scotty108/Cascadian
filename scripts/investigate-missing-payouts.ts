#!/usr/bin/env npx tsx
/**
 * STEP 1: Identify Missing Payout Data for Audit Wallet
 *
 * Goal: Understand why Polymarket shows $332K but we show -$546
 *
 * This script:
 * 1. Gets all 30 condition_ids for the wallet
 * 2. Checks which have payouts in vw_resolutions_truth
 * 3. Calculates position values
 * 4. Shows which markets need investigation
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const AUDIT_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('INVESTIGATING MISSING PAYOUT DATA');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Wallet: ${AUDIT_WALLET}`);
  console.log(`Expected P&L (Polymarket): $332,563`);
  console.log(`Current P&L (Our System): -$546\n`);

  // Query: Get all positions with payout status
  console.log('Fetching wallet positions and payout status...\n');

  const positions = await ch.query({
    query: `
      WITH positions AS (
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b,
          toInt32(outcome_index) AS outcome,
          sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_net,
          sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY condition_id_32b, outcome
        HAVING abs(shares_net) >= 0.01
      )
      SELECT
        p.condition_id_32b,
        p.outcome,
        p.shares_net,
        p.cash_net,
        abs(p.shares_net * (-p.cash_net / nullIf(p.shares_net, 0))) as position_value_usd,
        m.market_id_cid,
        r.payout_numerators,
        r.payout_denominator,
        CASE
          WHEN r.payout_denominator > 0 THEN 'HAS_PAYOUT'
          WHEN m.market_id_cid IS NOT NULL THEN 'MAPPED_NO_PAYOUT'
          ELSE 'NOT_MAPPED'
        END as status
      FROM positions p
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON p.condition_id_32b = m.condition_id_32b
      LEFT JOIN cascadian_clean.vw_resolutions_truth r
        ON p.condition_id_32b = r.condition_id_32b
      ORDER BY position_value_usd DESC
    `,
    format: 'JSONEachRow',
  });

  const posData = await positions.json<any[]>();

  // Summary stats
  const totalPositions = posData.length;
  const withPayouts = posData.filter(p => p.status === 'HAS_PAYOUT').length;
  const mappedNoPayouts = posData.filter(p => p.status === 'MAPPED_NO_PAYOUT').length;
  const notMapped = posData.filter(p => p.status === 'NOT_MAPPED').length;

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total Positions: ${totalPositions}`);
  console.log(`With Payouts: ${withPayouts} (${((withPayouts/totalPositions)*100).toFixed(1)}%)`);
  console.log(`Mapped but No Payouts: ${mappedNoPayouts} (${((mappedNoPayouts/totalPositions)*100).toFixed(1)}%)`);
  console.log(`Not Mapped: ${notMapped} (${((notMapped/totalPositions)*100).toFixed(1)}%)`);
  console.log('');

  // Calculate total position values
  const totalValue = posData.reduce((sum, p) => sum + parseFloat(p.position_value_usd), 0);
  const valueWithPayouts = posData
    .filter(p => p.status === 'HAS_PAYOUT')
    .reduce((sum, p) => sum + parseFloat(p.position_value_usd), 0);
  const valueMissingPayouts = posData
    .filter(p => p.status === 'MAPPED_NO_PAYOUT')
    .reduce((sum, p) => sum + parseFloat(p.position_value_usd), 0);

  console.log('POSITION VALUE BREAKDOWN');
  console.log('═'.repeat(80));
  console.log(`Total Position Value: $${totalValue.toFixed(2)}`);
  console.log(`Value with Payouts: $${valueWithPayouts.toFixed(2)} (${((valueWithPayouts/totalValue)*100).toFixed(1)}%)`);
  console.log(`Value Missing Payouts: $${valueMissingPayouts.toFixed(2)} (${((valueMissingPayouts/totalValue)*100).toFixed(1)}%)`);
  console.log('');

  // Show top 10 positions by value
  console.log('═'.repeat(80));
  console.log('TOP 10 POSITIONS BY VALUE');
  console.log('═'.repeat(80));
  console.log('');

  for (let i = 0; i < Math.min(10, posData.length); i++) {
    const p = posData[i];
    console.log(`${i + 1}. Position Value: $${parseFloat(p.position_value_usd).toFixed(2)}`);
    const conditionId = p.condition_id_32b || 'NULL';
    if (conditionId !== 'NULL') {
      console.log(`   Condition ID: ${conditionId.substring(0, 20)}...`);
    } else {
      console.log(`   Condition ID: NULL`);
    }
    console.log(`   Outcome: ${p.outcome}`);
    console.log(`   Shares: ${parseFloat(p.shares_net).toFixed(2)}`);
    console.log(`   Cash: $${parseFloat(p.cash_net).toFixed(2)}`);
    console.log(`   Status: ${p.status}`);

    if (p.status === 'HAS_PAYOUT') {
      console.log(`   Payout: [${p.payout_numerators}]/${p.payout_denominator}`);
    } else if (p.status === 'MAPPED_NO_PAYOUT') {
      const marketId = p.market_id_cid || 'N/A';
      if (marketId !== 'N/A') {
        console.log(`   Market ID: ${marketId.substring(0, 20)}...`);
      } else {
        console.log(`   Market ID: N/A`);
      }
      console.log(`   ⚠️  NEEDS INVESTIGATION - Market mapped but no payout data`);
    } else {
      console.log(`   ⚠️  NEEDS INVESTIGATION - Not in mapping table`);
    }
    console.log('');
  }

  // Show positions missing payouts
  const missingPayouts = posData.filter(p => p.status === 'MAPPED_NO_PAYOUT');

  if (missingPayouts.length > 0) {
    console.log('═'.repeat(80));
    console.log(`MARKETS MISSING PAYOUT DATA (${missingPayouts.length} markets)`);
    console.log('═'.repeat(80));
    console.log('');
    console.log('These markets are mapped but have no resolution data in vw_resolutions_truth.');
    console.log('Next steps:');
    console.log('1. Check if these markets are actually resolved (Polymarket API)');
    console.log('2. If resolved, fetch payout data from:');
    console.log('   - Polymarket Gamma API');
    console.log('   - On-chain CTF contract');
    console.log('   - Other tables (resolutions_src_api, market_resolutions_final)');
    console.log('');

    console.log('Condition IDs to investigate:');
    missingPayouts.slice(0, 10).forEach((p, i) => {
      console.log(`${i + 1}. ${p.condition_id_32b} (value: $${parseFloat(p.position_value_usd).toFixed(2)})`);
    });

    if (missingPayouts.length > 10) {
      console.log(`... and ${missingPayouts.length - 10} more`);
    }
    console.log('');
  }

  // Check other resolution sources
  console.log('═'.repeat(80));
  console.log('CHECKING OTHER RESOLUTION SOURCES');
  console.log('═'.repeat(80));
  console.log('');

  // Check market_resolutions_final
  try {
    console.log('Checking market_resolutions_final...');
    const finalCheck = await ch.query({
      query: `
        WITH wallet_cids AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
          FROM default.vw_trades_canonical
          WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
        )
        SELECT count(*) as found
        FROM wallet_cids w
        INNER JOIN default.market_resolutions_final r
          ON w.cid = r.condition_id_norm
      `,
      format: 'JSONEachRow',
    });
    const finalData = await finalCheck.json<any[]>();
    console.log(`  Found: ${finalData[0].found}/${totalPositions} positions`);
  } catch (e: any) {
    console.log(`  Error: ${e.message}`);
  }

  console.log('');

  // Final verdict
  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (withPayouts === 0 && mappedNoPayouts > 0) {
    console.log('❌ ZERO OVERLAP with resolved markets');
    console.log('');
    console.log('The wallet has 30 positions, but NONE overlap with the 176 markets');
    console.log('in vw_resolutions_truth.');
    console.log('');
    console.log('This means EITHER:');
    console.log('  A) These markets are still OPEN (not resolved yet)');
    console.log('  B) These markets ARE resolved, but payout data is missing');
    console.log('');
    console.log('Next step: Check if these markets are actually resolved.');
    console.log('Use Polymarket API or check on-chain to determine status.');
  } else if (withPayouts > 0 && withPayouts < totalPositions) {
    console.log(`⚠️  PARTIAL OVERLAP (${withPayouts}/${totalPositions} positions)`);
    console.log('');
    console.log('Some positions have payouts, others are missing.');
    console.log('Need to fetch missing payout data for the remaining positions.');
  } else {
    console.log('✅ ALL POSITIONS HAVE PAYOUTS');
    console.log('');
    console.log('This is unexpected - if all positions have payouts,');
    console.log('the Settled P&L should not be $0.');
    console.log('Check the P&L calculation logic.');
  }

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
