import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0x282aa94cc5751f08dfb9be98fecbae84b7e19bce';

async function checkCTF() {
  const q = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as tokens,
      toDateTime(event_timestamp) as ts,
      tx_hash
    FROM pm_ctf_events
    WHERE lower(user_address) = '${wallet.toLowerCase()}'
    ORDER BY event_timestamp
  `;

  const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const events = await res.json() as any[];

  console.log('CTF EVENTS FOR WALLET:', wallet);
  console.log('Total events:', events.length);
  console.log('='.repeat(110));

  const byType = new Map<string, number>();
  const byCondition = new Map<string, { splits: number; merges: number; redemptions: number; question?: string }>();

  for (const e of events) {
    byType.set(e.event_type, (byType.get(e.event_type) || 0) + Number(e.tokens));

    if (!byCondition.has(e.condition_id)) {
      byCondition.set(e.condition_id, { splits: 0, merges: 0, redemptions: 0 });
    }
    const c = byCondition.get(e.condition_id)!;
    if (e.event_type === 'PositionSplit') c.splits += Number(e.tokens);
    if (e.event_type === 'PositionsMerge') c.merges += Number(e.tokens);
    if (e.event_type === 'PayoutRedemption') c.redemptions += Number(e.tokens);

    const shortCond = '...' + e.condition_id.slice(-12);
    console.log(`${e.ts} | ${e.event_type.padEnd(20)} | ${Number(e.tokens).toFixed(0).padStart(10)} tokens | Condition: ${shortCond}`);
  }

  console.log('='.repeat(110));
  console.log('');
  console.log('TOTALS BY TYPE:');
  for (const [type, amount] of byType) {
    console.log(`  ${type}: ${amount.toFixed(0)} tokens`);
  }

  // Get question names for conditions
  const conditionIds = Array.from(byCondition.keys());
  if (conditionIds.length > 0) {
    const mapQ = `
      SELECT DISTINCT condition_id, question
      FROM pm_token_to_condition_map_v5
      WHERE condition_id IN ('${conditionIds.join("','")}')
    `;
    const mapRes = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
    const mapRows = await mapRes.json() as any[];
    for (const r of mapRows) {
      const c = byCondition.get(r.condition_id);
      if (c) c.question = r.question;
    }
  }

  console.log('');
  console.log('BY CONDITION:');
  for (const [cond, data] of byCondition) {
    const shortCond = '...' + cond.slice(-12);
    const q = (data.question || 'Unknown').slice(0, 40);
    console.log(`  ${q.padEnd(42)} | Splits=${data.splits.toFixed(0).padStart(8)}, Merges=${data.merges.toFixed(0).padStart(8)}, Redemptions=${data.redemptions.toFixed(0).padStart(8)}`);
  }

  // Calculate the missing tokens
  console.log('');
  console.log('=== SPLIT ANALYSIS ===');
  const totalSplits = byType.get('PositionSplit') || 0;
  console.log(`Total tokens from splits: ${totalSplits.toFixed(0)}`);
  console.log('These tokens appear in BOTH YES and NO positions after split');
  console.log('So actual token VALUE from splits = split_amount (you get both outcomes)');
}

checkCTF().catch(console.error);
