#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function analyzeResolutionCoverage() {
  try {
    console.log('=== MARKET RESOLUTION DATA ANALYSIS ===\n');

    // First, get the baseline: how many unique conditions have we traded?
    console.log('1. BASELINE: Total traded conditions\n');
    const tradedResult = await client.query({
      query: `SELECT COUNT(DISTINCT condition_id) as traded_conditions FROM trades_raw WHERE condition_id != ''`,
      format: 'JSONEachRow'
    });
    const traded = await tradedResult.json();
    const totalTradedConditions = traded[0].traded_conditions;
    console.log(`Total unique condition_ids in trades_raw: ${totalTradedConditions}\n`);

    // Key resolution tables discovered
    const resolutionTables = [
      { name: 'market_resolutions_final', desc: 'Main resolution table' },
      { name: 'ctf_payout_data', desc: 'CTF payout vectors (canonical)' },
      { name: 'gamma_resolved', desc: 'Gamma API resolved markets' },
      { name: 'staging_resolutions_union', desc: 'Staging/union table' },
      { name: 'resolution_candidates', desc: 'Resolution candidates' },
      { name: 'market_resolutions', desc: 'Market resolutions (old)' },
      { name: 'market_resolutions_by_market', desc: 'Market resolutions by market' }
    ];

    console.log('2. RESOLUTION TABLE ANALYSIS\n');

    for (const table of resolutionTables) {
      console.log(`--- ${table.name} (${table.desc}) ---`);

      // Get schema
      const schemaResult = await client.query({
        query: `DESCRIBE ${table.name}`,
        format: 'JSONEachRow'
      });
      const schema = await schemaResult.json();
      const columns = schema.map((c: any) => c.name).join(', ');
      console.log(`Columns: ${columns}`);

      // Row count
      const countResult = await client.query({
        query: `SELECT COUNT(*) as cnt FROM ${table.name}`,
        format: 'JSONEachRow'
      });
      const count = await countResult.json();
      console.log(`Total rows: ${count[0].cnt}`);

      // Check for key resolution fields
      const hasWinningIndex = schema.some((c: any) => c.name.includes('winning'));
      const hasPayoutNumerators = schema.some((c: any) => c.name.includes('payout_numerators'));
      const hasPayoutDenominator = schema.some((c: any) => c.name.includes('payout_denominator'));
      const hasConditionId = schema.some((c: any) => c.name.includes('condition_id'));

      console.log(`Has winning_index: ${hasWinningIndex}`);
      console.log(`Has payout_numerators: ${hasPayoutNumerators}`);
      console.log(`Has payout_denominator: ${hasPayoutDenominator}`);
      console.log(`Has condition_id: ${hasConditionId}`);

      // If it has condition_id, check overlap with trades
      if (hasConditionId) {
        try {
          const overlapResult = await client.query({
            query: `
              SELECT
                COUNT(DISTINCT r.condition_id) as conditions_in_table,
                COUNT(DISTINCT t.condition_id) as conditions_matched
              FROM ${table.name} r
              LEFT JOIN (
                SELECT DISTINCT condition_id FROM trades_raw WHERE condition_id != ''
              ) t ON lower(r.condition_id) = lower(t.condition_id)
            `,
            format: 'JSONEachRow'
          });
          const overlap = await overlapResult.json();
          const matchRate = ((overlap[0].conditions_matched / totalTradedConditions) * 100).toFixed(2);
          console.log(`Conditions in table: ${overlap[0].conditions_in_table}`);
          console.log(`Conditions matched with trades: ${overlap[0].conditions_matched}`);
          console.log(`Coverage: ${matchRate}% of traded conditions`);
        } catch (err: any) {
          console.log(`Error checking overlap: ${err.message}`);
        }
      }

      // Sample a few rows
      try {
        const sampleResult = await client.query({
          query: `SELECT * FROM ${table.name} LIMIT 2`,
          format: 'JSONEachRow'
        });
        const sample = await sampleResult.json();
        console.log(`Sample row: ${JSON.stringify(sample[0], null, 2)}`);
      } catch (err) {
        console.log('Could not sample rows');
      }

      console.log('\n');
    }

    // Critical test: Join trades_raw with each resolution source
    console.log('3. CRITICAL TEST: Coverage of trades by resolution source\n');

    for (const table of resolutionTables.filter(t => t.name !== 'gamma_resolved')) {
      try {
        const joinTest = await client.query({
          query: `
            SELECT
              COUNT(DISTINCT t.condition_id) as total_traded_conditions,
              COUNT(DISTINCT CASE WHEN r.condition_id IS NOT NULL THEN t.condition_id END) as resolved_conditions,
              COUNT(*) as total_trades,
              SUM(CASE WHEN r.condition_id IS NOT NULL THEN 1 ELSE 0 END) as resolved_trades
            FROM trades_raw t
            LEFT JOIN ${table.name} r ON lower(t.condition_id) = lower(r.condition_id)
            WHERE t.condition_id != ''
          `,
          format: 'JSONEachRow'
        });
        const result = await joinTest.json();
        const conditionCoverage = ((result[0].resolved_conditions / result[0].total_traded_conditions) * 100).toFixed(2);
        const tradeCoverage = ((result[0].resolved_trades / result[0].total_trades) * 100).toFixed(2);

        console.log(`${table.name}:`);
        console.log(`  - Condition coverage: ${result[0].resolved_conditions}/${result[0].total_traded_conditions} (${conditionCoverage}%)`);
        console.log(`  - Trade coverage: ${result[0].resolved_trades}/${result[0].total_trades} (${tradeCoverage}%)`);
      } catch (err: any) {
        console.log(`${table.name}: Error - ${err.message}`);
      }
    }

    // Check gamma_resolved separately (uses 'cid' not 'condition_id')
    try {
      const gammaTest = await client.query({
        query: `
          SELECT
            COUNT(DISTINCT t.condition_id) as total_traded_conditions,
            COUNT(DISTINCT CASE WHEN r.cid IS NOT NULL THEN t.condition_id END) as resolved_conditions,
            COUNT(*) as total_trades,
            SUM(CASE WHEN r.cid IS NOT NULL THEN 1 ELSE 0 END) as resolved_trades
          FROM trades_raw t
          LEFT JOIN gamma_resolved r ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.cid)
          WHERE t.condition_id != ''
        `,
        format: 'JSONEachRow'
      });
      const result = await gammaTest.json();
      const conditionCoverage = ((result[0].resolved_conditions / result[0].total_traded_conditions) * 100).toFixed(2);
      const tradeCoverage = ((result[0].resolved_trades / result[0].total_trades) * 100).toFixed(2);

      console.log(`\ngamma_resolved:`);
      console.log(`  - Condition coverage: ${result[0].resolved_conditions}/${result[0].total_traded_conditions} (${conditionCoverage}%)`);
      console.log(`  - Trade coverage: ${result[0].resolved_trades}/${result[0].total_trades} (${tradeCoverage}%)`);
    } catch (err: any) {
      console.log(`gamma_resolved: Error - ${err.message}`);
    }

    console.log('\n4. PAYOUT VECTOR DATA (for P&L calculation)\n');

    // Focus on tables with payout_numerators + payout_denominator
    const payoutTables = ['ctf_payout_data', 'market_resolutions_final'];

    for (const tableName of payoutTables) {
      console.log(`--- ${tableName} ---`);

      try {
        const payoutCheck = await client.query({
          query: `
            SELECT
              COUNT(*) as total_rows,
              COUNT(payout_numerators) as has_numerators,
              COUNT(payout_denominator) as has_denominator,
              COUNT(CASE WHEN length(payout_numerators) > 0 THEN 1 END) as numerators_populated
            FROM ${tableName}
          `,
          format: 'JSONEachRow'
        });
        const payout = await payoutCheck.json();
        console.log(`Total rows: ${payout[0].total_rows}`);
        console.log(`Has payout_numerators: ${payout[0].has_numerators}`);
        console.log(`Has payout_denominator: ${payout[0].has_denominator}`);
        console.log(`Payout numerators populated: ${payout[0].numerators_populated}`);

        // Sample payout data
        const sampleResult = await client.query({
          query: `SELECT condition_id, payout_numerators, payout_denominator FROM ${tableName} WHERE length(payout_numerators) > 0 LIMIT 3`,
          format: 'JSONEachRow'
        });
        const samples = await sampleResult.json();
        console.log('Sample payout vectors:');
        samples.forEach((s: any, i: number) => {
          console.log(`  ${i+1}. ${s.condition_id}: numerators=${JSON.stringify(s.payout_numerators)}, denominator=${s.payout_denominator}`);
        });
      } catch (err: any) {
        console.log(`Error: ${err.message}`);
      }
      console.log('');
    }

    console.log('5. RECOMMENDATION\n');
    console.log('Based on this analysis:');
    console.log('- Best resolution source for P&L: _____ (highest coverage with payout vectors)');
    console.log('- Data gaps: _____ % of traded conditions lack resolution');
    console.log('- Next steps: _____ \n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

analyzeResolutionCoverage();
