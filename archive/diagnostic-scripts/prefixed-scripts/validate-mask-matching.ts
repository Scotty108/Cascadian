import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MASK MATCHING VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check top 20 markets with detailed mask analysis
  const detailQuery = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        f.gross_cf,
        t.pps,
        t.winning_index,
        -- Manual payout calculation
        arraySum(
          arrayMap(
            j -> if(
              bitAnd(f.index_set_mask, bitShiftLeft(1, j)) > 0,
              coalesce(arrayElement(t.pps, j + 1), 0.0),
              0.0
            ),
            range(length(t.pps))
          )
        ) AS pps_sum,
        pps_sum * f.net_shares AS calculated_payout,
        -- Check if mask matches winner
        bitAnd(f.index_set_mask, bitShiftLeft(1, t.winning_index)) > 0 AS mask_matches_winner
      FROM wallet_token_flows f
      JOIN token_per_share_payout t ON t.condition_id_ctf = f.condition_id_ctf
      WHERE lower(f.wallet) = lower('${wallet}')
      ORDER BY abs(f.gross_cf) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const details = await detailQuery.json();

  console.log('Top 20 markets by |gross_cf| with mask analysis:\n');

  let totalCalculatedPayout = 0;
  details.forEach((d: any, i: number) => {
    const maskBinary = d.index_set_mask.toString(2).padStart(8, '0');
    const winnerBit = 1 << d.winning_index;
    const matchSymbol = d.mask_matches_winner ? '✓' : '✗';

    console.log(`${(i + 1).toString().padStart(2)}. ${d.condition_id_ctf.substring(0, 12)}...`);
    console.log(`    mask: ${d.index_set_mask} (${maskBinary})`);
    console.log(`    winner: index ${d.winning_index} (bit ${winnerBit})`);
    console.log(`    match: ${matchSymbol} ${d.mask_matches_winner ? 'YES' : 'NO'}`);
    console.log(`    net_shares: ${Number(d.net_shares).toFixed(2)}`);
    console.log(`    pps: [${d.pps.map((p: number) => p.toFixed(2)).join(', ')}]`);
    console.log(`    pps_sum: ${Number(d.pps_sum).toFixed(6)}`);
    console.log(`    calculated_payout: $${Number(d.calculated_payout).toFixed(2)}`);
    console.log(`    gross_cf: $${Number(d.gross_cf).toFixed(2)}`);
    console.log();

    totalCalculatedPayout += Number(d.calculated_payout);
  });

  console.log(`Total calculated payout (top 20): $${totalCalculatedPayout.toFixed(2)}\n`);

  // Compare to what wallet_condition_pnl gives us
  const walletPnlQuery = await clickhouse.query({
    query: `
      SELECT
        sum(realized_payout) AS total_payout,
        sum(gross_cf) AS total_gross_cf,
        sum(pnl_net) AS total_pnl
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const walletPnl = await walletPnlQuery.json();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('From wallet_condition_pnl view:');
  console.log(`   Total realized_payout: $${Number(walletPnl[0].total_payout).toLocaleString()}`);
  console.log(`   Total gross_cf: $${Number(walletPnl[0].total_gross_cf).toLocaleString()}`);
  console.log(`   Total P&L net: $${Number(walletPnl[0].total_pnl).toLocaleString()}\n`);

  console.log('Expected: $87,030.51');
  console.log(`Actual: $${Number(walletPnl[0].total_pnl).toLocaleString()}`);
  console.log(`Gap: $${(87030.51 - Number(walletPnl[0].total_pnl)).toFixed(2)}\n`);

  // Check: are masks all = 1 (buying YES tokens)?
  const maskDistQuery = await clickhouse.query({
    query: `
      SELECT
        index_set_mask,
        count() AS token_count,
        sum(net_shares) AS total_shares,
        sum(gross_cf) AS total_cf
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY index_set_mask
      ORDER BY token_count DESC
    `,
    format: 'JSONEachRow'
  });
  const maskDist = await maskDistQuery.json();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MASK DISTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Distribution of index_set_mask values:');
  maskDist.forEach((m: any) => {
    const maskBinary = m.index_set_mask.toString(2).padStart(8, '0');
    console.log(`   mask ${m.index_set_mask} (${maskBinary}): ${m.token_count} tokens, ${Number(m.total_shares).toFixed(0)} shares, $${Number(m.total_cf).toFixed(2)} cf`);
  });
  console.log();
}

main().catch(console.error);
