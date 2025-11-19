import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync } from 'fs';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.3: POSITION STATUS (BURNED VS HELD)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}\n`);

  // Read target CTF IDs
  const csv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
  const lines = csv.split('\n').slice(1).filter(l => l.trim());
  const ctfIds = lines.map(l => l.split(',')[0]);

  console.log(`Checking position status for ${ctfIds.length} unresolved markets...\n`);

  let totalBurned = 0;
  let totalHeld = 0;
  let totalReceived = 0;

  for (const ctfId of ctfIds) {
    console.log(`\n═══ ${ctfId.substring(0, 20)}... ═══\n`);

    // Get all ERC1155 transfers for this CTF
    const result = await clickhouse.query({
      query: `
        WITH transfers AS (
          SELECT
            lower(from_address) AS from_addr,
            lower(to_address) AS to_addr,
            toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6 AS shares
          FROM erc1155_transfers
          WHERE lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') = lower('${ctfId}')
            AND (lower(from_address) = lower('${WALLET}') OR lower(to_address) = lower('${WALLET}'))
        )
        SELECT
          sumIf(shares, to_addr = lower('${WALLET}')) AS total_received,
          sumIf(shares, from_addr = lower('${WALLET}') AND to_addr = '0x0000000000000000000000000000000000000000') AS total_burned,
          sumIf(shares, from_addr = lower('${WALLET}') AND to_addr != '0x0000000000000000000000000000000000000000') AS total_sent,
          total_received - total_burned - total_sent AS net_position
        FROM transfers
      `,
      format: 'JSONEachRow'
    });

    const rows: any[] = await result.json();
    const position = rows[0];

    const received = Number(position.total_received);
    const burned = Number(position.total_burned);
    const sent = Number(position.total_sent);
    const net = Number(position.net_position);

    console.log(`   Received: ${received.toLocaleString()} shares`);
    console.log(`   Burned: ${burned.toLocaleString()} shares`);
    console.log(`   Sent: ${sent.toLocaleString()} shares`);
    console.log(`   ────────────────────────────────`);
    console.log(`   Net Position: ${net.toLocaleString()} shares`);

    if (Math.abs(net) < 0.01) {
      console.log(`   ✅ Position CLOSED (all burned/sent)`);
    } else if (net > 0) {
      console.log(`   ⚠️  Position OPEN (${net.toLocaleString()} shares held)`);
    } else {
      console.log(`   ⚠️  Negative position? (check data)`);
    }

    totalReceived += received;
    totalBurned += burned;
    totalHeld += Math.max(0, net);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Total across ${ctfIds.length} unresolved markets:`);
  console.log(`   Received: ${totalReceived.toLocaleString()} shares`);
  console.log(`   Burned: ${totalBurned.toLocaleString()} shares`);
  console.log(`   Currently Held: ${totalHeld.toLocaleString()} shares\n`);

  if (totalHeld > 0) {
    console.log(`   ⚠️  Wallet holds ${totalHeld.toLocaleString()} shares in unresolved markets`);
    console.log(`   This represents UNREALIZED P&L\n`);
    console.log(`   Next: Calculate unrealized P&L (Phase 7.4)\n`);
  } else {
    console.log(`   ✅ All positions closed (burned or sent)`);
    console.log(`   The burned shares will realize value when markets resolve\n`);
    console.log(`   The $80K gap is from unresolved markets, not missing data\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
