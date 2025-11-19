import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'default'
});

const HIGH_VOLUME_CIDS = [
  'c007c362e141a1ca5401a9ec6079e01bec52d97fd10fc094c22f5a4614328058',
  'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
  'bbad52c7a569d729424c917dd3181149d59b5f4fc3115d510b91197c4368c22a'
];

async function main() {
  console.log('Testing market_outcomes_expanded table');
  
  // Test high-volume markets
  console.log('\nHigh-volume market test:');
  for (const cid of HIGH_VOLUME_CIDS) {
    const testResult = await client.query({
      query: "SELECT * FROM market_outcomes_expanded WHERE condition_id_norm = '" + cid + "' ORDER BY outcome_idx",
      format: 'JSONEachRow'
    });
    const outcomes = await testResult.json<any>();
    
    console.log('\nCID: ' + cid.substring(0, 20) + '...');
    if (outcomes.length > 0) {
      console.log('  FOUND! ' + outcomes.length + ' outcomes:');
      outcomes.forEach(row => {
        console.log('    Outcome ' + row.outcome_idx + ': ' + row.outcome_label);
      });
    } else {
      console.log('  Not found');
    }
  }
  
  // Check outcome distribution
  console.log('\n\nOutcome count distribution:');
  const distResult = await client.query({
    query: `
      SELECT 
        num_outcomes,
        count(*) as market_count
      FROM (
        SELECT 
          condition_id_norm,
          count(*) as num_outcomes
        FROM market_outcomes_expanded
        GROUP BY condition_id_norm
      )
      GROUP BY num_outcomes
      ORDER BY num_outcomes
    `,
    format: 'JSONEachRow'
  });
  const dist = await distResult.json<any>();
  
  dist.forEach(row => {
    console.log('  ' + row.num_outcomes + ' outcomes: ' + row.market_count + ' markets');
  });
  
  // Now test the COMPLETE join: clob_fills → token_to_cid_bridge → market_outcomes_expanded
  console.log('\n\nTesting complete join for P&L calculation:');
  console.log('clob_fills → token_to_cid_bridge → market_outcomes_expanded');
  
  const joinResult = await client.query({
    query: `
      SELECT 
        b.cid_hex,
        b.outcome_index as traded_outcome,
        m.outcome_idx,
        m.outcome_label,
        count(*) as trade_count
      FROM clob_fills c
      INNER JOIN cascadian_clean.token_to_cid_bridge b
        ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      INNER JOIN market_outcomes_expanded m
        ON lower(replaceAll(b.cid_hex, '0x', '')) = m.condition_id_norm
      WHERE match(c.asset_id, '^[0-9]+$')
      GROUP BY b.cid_hex, b.outcome_index, m.outcome_idx, m.outcome_label
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const joins = await joinResult.json<any>();
  
  console.log('\nTop 20 joined results:');
  joins.forEach((row, idx) => {
    console.log('\n  ' + (idx + 1) + '. CID: ' + row.cid_hex.substring(0, 20) + '...');
    console.log('     Traded outcome: ' + row.traded_outcome);
    console.log('     Market outcome: ' + row.outcome_idx + ' (' + row.outcome_label + ')');
    console.log('     Trades: ' + row.trade_count);
  });
  
  // Verify outcome matching
  console.log('\n\nVerifying traded_outcome == market outcome_idx:');
  const matchResult = await client.query({
    query: `
      SELECT 
        countIf(b.outcome_index = toUInt16(m.outcome_idx)) as matches,
        countIf(b.outcome_index != toUInt16(m.outcome_idx)) as mismatches,
        count(*) as total
      FROM clob_fills c
      INNER JOIN cascadian_clean.token_to_cid_bridge b
        ON lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      INNER JOIN market_outcomes_expanded m
        ON lower(replaceAll(b.cid_hex, '0x', '')) = m.condition_id_norm
      WHERE match(c.asset_id, '^[0-9]+$')
        AND b.outcome_index = toUInt16(m.outcome_idx)
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const matchStats = await matchResult.json<any>();
  
  console.log('  Matches: ' + matchStats[0].matches);
  console.log('  Mismatches: ' + matchStats[0].mismatches);
  console.log('  Total: ' + matchStats[0].total);
  
  // Coverage of clob_fills
  console.log('\n\nCoverage analysis:');
  const coverageResult = await client.query({
    query: `
      SELECT 
        count(*) as total_clob_fills,
        countIf(m.outcome_label IS NOT NULL) as mappable_to_outcomes
      FROM clob_fills c
      LEFT JOIN cascadian_clean.token_to_cid_bridge b
        ON match(c.asset_id, '^[0-9]+$') 
        AND lower(concat('0x', hex(toUInt256(c.asset_id)))) = lower(b.token_hex)
      LEFT JOIN market_outcomes_expanded m
        ON lower(replaceAll(b.cid_hex, '0x', '')) = m.condition_id_norm
        AND b.outcome_index = toUInt16(m.outcome_idx)
      WHERE c.asset_id != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageResult.json<any>();
  
  const total = parseInt(coverage[0].total_clob_fills);
  const mappable = parseInt(coverage[0].mappable_to_outcomes);
  const pct = (mappable * 100.0 / total).toFixed(2);
  
  console.log('  Total clob_fills: ' + total);
  console.log('  Mappable to outcomes: ' + mappable);
  console.log('  Coverage: ' + pct + '%');
  
  await client.close();
  console.log('\n\nAnalysis complete!');
}

main().catch(console.error);
