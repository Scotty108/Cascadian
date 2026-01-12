import { config } from 'dotenv';
config({ path: '/Users/scotty/Projects/Cascadian-app/.env.local' });
import { clickhouse } from '/Users/scotty/Projects/Cascadian-app/lib/clickhouse/client';

// Perfect tier: CLOB-only + non-phantom wallets
const testWallets = [
  { wallet: '0x05c8cff6d9d38d72bf8671a26a48b660802a36b8', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0xd65c845105707a99766a10d02a00c37c321ac65c', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0xcf8f7445174af3e17151278485e812ed7a15f939', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x3eb15a2f1c5d9e5fc3b37c81e9e1329f9e09668e', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0xc205aeaef1a7f0dfe60d7595b39bee2175437ce9', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x4324a3f34524eea09f6b10f7aa0eebed6026719f', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x07bb4362767e3bb1cbe8673631dd15f9e5f61aad', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x494bc59b0b8ac0770a7b0385a08848a8bb660285', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x9718c56214eacc7863ba7089cafd0dd39a7c819e', cohort: 'perfect_tier', has_ctf: false },
  { wallet: '0x36677bb7f6c2aa86e7b566fd04eaa779756b1faf', cohort: 'perfect_tier', has_ctf: false },
];

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p; // Latest PnL value
      }
    }
  } catch (e) {
    console.error(`API error for ${wallet}:`, e);
  }
  return null;
}

async function getUnifiedPnL(wallet: string): Promise<{ pnl: number; has_phantom: boolean }> {
  const walletLower = wallet.toLowerCase();

  // Simplified CLOB-only query for speed
  const query = `
    WITH
      wallet_trades AS (
        SELECT transaction_hash, token_id, side, role,
               usdc_amount/1e6 AS usdc, token_amount/1e6 AS tokens, fee_amount/1e6 AS fee
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${walletLower}'
      ),
      self_fill_txs AS (
        SELECT transaction_hash FROM wallet_trades
        GROUP BY transaction_hash
        HAVING countIf(role='maker')>0 AND countIf(role='taker')>0
      ),
      canon_clob AS (
        SELECT m.condition_id, m.outcome_index, side,
               (usdc + if(side='buy', fee, -fee)) AS usdc_net, tokens
        FROM wallet_trades t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE m.condition_id != ''
          AND (transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs)
               OR (transaction_hash IN (SELECT transaction_hash FROM self_fill_txs) AND role='taker'))
      ),
      positions AS (
        SELECT condition_id, outcome_index,
          sumIf(tokens, side='buy') - sumIf(tokens, side='sell') AS net_tokens,
          sumIf(usdc_net, side='sell') - sumIf(usdc_net, side='buy') AS cash_flow,
          sumIf(tokens, side='buy') AS total_bought,
          sumIf(tokens, side='sell') AS total_sold
        FROM canon_clob
        GROUP BY condition_id, outcome_index
      ),
      with_res AS (
        SELECT p.*,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 AS won
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      ),
      agg AS (
        SELECT
          sum(cash_flow) AS cf,
          sumIf(net_tokens, net_tokens > 0 AND won) AS lw,
          sumIf(-net_tokens, net_tokens < 0 AND won) AS sl,
          sum(total_sold) AS total_sold,
          sum(total_bought) AS total_bought
        FROM with_res
      )
    SELECT
      round(cf + lw - sl, 4) AS pnl,
      total_sold > total_bought * 1.01 AS has_phantom
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return {
    pnl: Number(rows[0]?.pnl) || 0,
    has_phantom: rows[0]?.has_phantom === 1
  };
}

async function main() {
  console.log('=== Stratified Validation Suite ===\n');
  console.log('Wallet                                     | Cohort       | CTF | API PnL      | CLOB PnL     | Diff       | Phantom');
  console.log('-------------------------------------------|--------------|-----|--------------|--------------|------------|--------');

  let passCount = 0;
  let failCount = 0;

  for (const { wallet, cohort, has_ctf } of testWallets) {
    const apiPnl = await getApiPnL(wallet);
    const { pnl: clobPnl, has_phantom } = await getUnifiedPnL(wallet);

    if (apiPnl === null) {
      console.log(`${wallet} | ${cohort.padEnd(12)} | ${has_ctf ? 'Y' : 'N'}   | API ERROR    | ${clobPnl.toFixed(2).padStart(12)} | N/A        | ${has_phantom ? 'Y' : 'N'}`);
      continue;
    }

    const diff = Math.abs(clobPnl - apiPnl);
    const status = diff < 1 ? '✓' : (has_phantom ? '⚠' : '✗');

    if (diff < 1) passCount++;
    else failCount++;

    console.log(`${wallet} | ${cohort.padEnd(12)} | ${has_ctf ? 'Y' : 'N'}   | ${apiPnl.toFixed(2).padStart(12)} | ${clobPnl.toFixed(2).padStart(12)} | ${diff.toFixed(2).padStart(9)} ${status} | ${has_phantom ? 'Y' : 'N'}`);
  }

  console.log('\n---');
  console.log(`Passed: ${passCount}/${testWallets.length} (sub-$1 accuracy)`);
  console.log(`Failed: ${failCount}/${testWallets.length}`);
}

main().catch(console.error);
