/**
 * Test the hypothesis: Does DB PnL / 2 = API PnL?
 * 
 * If Polymarket's single-outcome accounting is the full explanation,
 * then halving our dual-outcome calculation should match the API.
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 60000
});

// Test wallets with known API values
const testWallets = [
  { label: 'W1', addr: '0x9d36c904930a7d06c5403f9e16996e919f586486', api_pnl: 12298.89 },
  { label: 'W2', addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', api_pnl: 4404.49 },
  { label: 'W3', addr: '0x418db17eaa8f25eaf2085657d0becd82462c6786', api_pnl: 5.65 },
  { label: 'W4', addr: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', api_pnl: -0.09 },
  { label: 'W5', addr: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', api_pnl: 155.31 },
  { label: 'W6', addr: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', api_pnl: 2157.59 },
];

async function calculateDbPnl(wallet: string): Promise<number> {
  // Standard CLOB formula with deduplication
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens,
          any(side) as side
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          d.*,
          m.condition_id,
          m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      by_outcome AS (
        SELECT
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT
          b.*,
          r.payout_numerators,
          -- Parse resolution: [1,0] means outcome 0 wins, [0,1] means outcome 1 wins
          CASE
            WHEN r.payout_numerators LIKE '[1,%' AND b.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[0,%' AND b.outcome_index = 1 THEN 1.0
            ELSE 0.0
          END as resolution_price
        FROM by_outcome b
        LEFT JOIN pm_condition_resolutions r ON lower(b.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL  -- Only resolved markets
      )
      SELECT
        SUM(cash_flow + final_shares * resolution_price) as total_pnl
      FROM with_resolution
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];
  return rows[0]?.total_pnl || 0;
}

async function main() {
  console.log('=== TESTING: DB PnL / 2 = API PnL HYPOTHESIS ===');
  console.log('');
  console.log('If Polymarket uses single-outcome accounting, dividing our');
  console.log('dual-outcome calculation by 2 should match the API values.');
  console.log('');
  console.log('Wallet | API PnL      | DB PnL       | DB/2         | Match?  | Ratio');
  console.log('-'.repeat(80));

  let matchCount = 0;
  let totalWallets = 0;

  for (const w of testWallets) {
    const dbPnl = await calculateDbPnl(w.addr);
    const dbHalf = dbPnl / 2;
    
    // Calculate error percentage
    const errorPct = w.api_pnl !== 0 
      ? Math.abs((dbHalf - w.api_pnl) / w.api_pnl) * 100 
      : Math.abs(dbHalf) < 1 ? 0 : 100;
    
    const isMatch = errorPct < 10;  // Within 10% = match
    if (isMatch) matchCount++;
    totalWallets++;

    const ratio = w.api_pnl !== 0 ? (dbPnl / w.api_pnl).toFixed(2) : 'N/A';
    
    console.log(
      `${w.label.padEnd(6)} | ` +
      `$${w.api_pnl.toFixed(2).padStart(10)} | ` +
      `$${dbPnl.toFixed(2).padStart(10)} | ` +
      `$${dbHalf.toFixed(2).padStart(10)} | ` +
      `${isMatch ? '✓ YES' : '✗ NO '.padEnd(7)} | ` +
      `${ratio}x`
    );
  }

  console.log('-'.repeat(80));
  console.log(`Match rate: ${matchCount}/${totalWallets} (${((matchCount/totalWallets)*100).toFixed(0)}%)`);
  console.log('');
  
  if (matchCount === totalWallets) {
    console.log('✓ HYPOTHESIS CONFIRMED: DB PnL / 2 = API PnL');
    console.log('The 2x ratio is consistent, indicating single-outcome accounting.');
  } else if (matchCount > totalWallets / 2) {
    console.log('~ HYPOTHESIS PARTIALLY CONFIRMED: Some wallets match, others don\'t.');
    console.log('There may be additional factors for non-matching wallets.');
  } else {
    console.log('✗ HYPOTHESIS REJECTED: The 2x ratio is not consistent.');
    console.log('The discrepancy has another cause.');
  }

  await client.close();
}

main().catch(console.error);
