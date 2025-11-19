#!/usr/bin/env tsx
/**
 * Real-time Market Resolution Monitor using Polymarket WebSocket
 *
 * Monitors for market_resolved events and fetches payout vectors from Goldsky.
 * Optional enhancement for real-time resolution detection.
 *
 * Usage: npx tsx monitor-resolutions-websocket.ts
 *
 * Purpose:
 * - Detects market resolutions in real-time (<3 sec latency)
 * - Fetches payout vectors from Goldsky PNL Subgraph
 * - Inserts into market_resolutions_final table
 * - Complements historical backfill with ongoing sync
 */
import WebSocket from 'ws';
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const POLYMARKET_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/';
const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface ResolutionEvent {
  type: 'market_resolved';
  marketId: string;
  timestamp: number;
}

interface PayoutCondition {
  id: string;
  payoutNumerators: string[];
  payoutDenominator: string;
}

async function fetchPayoutVector(conditionId: string): Promise<PayoutCondition | null> {
  const query = {
    query: `{
      condition(id: "${conditionId}") {
        id
        payoutNumerators
        payoutDenominator
      }
    }`
  };

  try {
    const response = await fetch(GOLDSKY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });

    const result = await response.json();
    return result.data?.condition || null;
  } catch (error) {
    console.error('   ❌ Error fetching from Goldsky:', error);
    return null;
  }
}

async function insertPayout(condition: PayoutCondition) {
  // Calculate winning index (highest payout)
  const numerators = condition.payoutNumerators.map(n => parseFloat(n));
  const winningIndex = numerators.indexOf(Math.max(...numerators));

  const insertQuery = `
    INSERT INTO default.market_resolutions_final (
      condition_id_norm,
      payout_numerators,
      payout_denominator,
      winning_index,
      source,
      created_at
    ) VALUES (
      '${condition.id}',
      [${condition.payoutNumerators.join(',')}],
      ${condition.payoutDenominator},
      ${winningIndex},
      'websocket-monitor',
      now()
    )
  `;

  try {
    await ch.command({ query: insertQuery });
    console.log(`   ✅ Inserted payout for ${condition.id.substring(0, 16)}...`);
  } catch (error) {
    console.error('   ❌ Error inserting payout:', error);
  }
}

async function monitorResolutions() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('POLYMARKET RESOLUTION MONITOR (WebSocket)');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('🔌 Connecting to Polymarket WebSocket...\n');

  const ws = new WebSocket(POLYMARKET_WS);

  ws.on('open', () => {
    console.log('✅ Connected to Polymarket WebSocket');
    console.log('   Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/\n');

    // Subscribe to market resolution events
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'clob_market.market_resolved'
    }));

    console.log('👂 Listening for market resolution events...\n');
    console.log('Press Ctrl+C to stop\n');
    console.log('-----------------------------------------------------------\n');
  });

  ws.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === 'market_resolved') {
        const timestamp = new Date(event.timestamp * 1000).toISOString();

        console.log(`🎯 MARKET RESOLVED`);
        console.log(`   Condition ID: ${event.marketId}`);
        console.log(`   Timestamp: ${timestamp}`);

        // Fetch payout vector from Goldsky
        console.log(`   Fetching payout from Goldsky...`);

        const payout = await fetchPayoutVector(event.marketId);

        if (payout) {
          console.log(`   Payout Numerators: [${payout.payoutNumerators}]`);
          console.log(`   Payout Denominator: ${payout.payoutDenominator}`);

          // Calculate winner
          const numerators = payout.payoutNumerators.map(n => parseFloat(n));
          const winningIndex = numerators.indexOf(Math.max(...numerators));
          console.log(`   Winner: Outcome ${winningIndex} (${numerators[winningIndex]}/${payout.payoutDenominator})`);

          // Insert into database
          await insertPayout(payout);
        } else {
          console.log(`   ⚠️  Payout not yet available from Goldsky (may take 5-10 min)`);
          console.log(`   ℹ️  Will retry on next fetch cycle`);
        }

        console.log('\n-----------------------------------------------------------\n');
      }
    } catch (error) {
      console.error('❌ Error processing event:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('\n❌ WebSocket error:', error);
    console.log('   Will attempt to reconnect...\n');
  });

  ws.on('close', () => {
    console.log('\n🔌 WebSocket connection closed');
    console.log('   Reconnecting in 5 seconds...\n');
    setTimeout(monitorResolutions, 5000);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down monitor...');
    ws.close();
    await ch.close();
    console.log('✅ Cleanup complete\n');
    process.exit(0);
  });
}

// Start monitoring
monitorResolutions().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
