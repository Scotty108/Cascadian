#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve as resolvePath } from 'path';
config({ path: resolvePath(process.cwd(), '.env.local') });

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const CONDITION_RESOLUTION_TOPIC = ethers.id('ConditionResolution(bytes32,address,bytes32,uint256,uint256[])');
const POLYGON_RPC = process.env.POLYGON_RPC_URL;

if (!POLYGON_RPC) {
  console.error('Missing POLYGON_RPC_URL in .env.local');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
const ctf = new ethers.Contract(
  CTF_ADDRESS,
  [
    'function getOutcomeSlotCount(bytes32) view returns (uint256)',
    'function payoutNumerators(bytes32,uint256) view returns (uint256)',
    'function payoutDenominator(bytes32) view returns (uint256)'
  ],
  provider
);

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface Options {
  wallet?: string;
  ids?: string[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--wallet' && args[i + 1]) {
      opts.wallet = args[++i];
    } else if (arg === '--ids' && args[i + 1]) {
      opts.ids = args[++i].split(',').map((v) => v.trim()).filter(Boolean);
    }
  }
  return opts;
}

async function resolveConditionIds(opts: Options): Promise<string[]> {
  if (opts.ids?.length) {
    return opts.ids.map(normalizeConditionId);
  }
  if (!opts.wallet) {
    throw new Error('Provide either --wallet or --ids');
  }
  const query = `
    WITH wallet_positions AS (
      SELECT DISTINCT lower(m.condition_id_32b) AS condition_id
      FROM cascadian_clean.vw_positions_open p
      INNER JOIN cascadian_clean.token_condition_market_map m
        ON lower(p.market_cid) = lower(m.market_id_cid)
      WHERE lower(p.wallet) = lower({wallet:String})
    ),
    resolved AS (
      SELECT DISTINCT toString(condition_id_norm) AS condition_id
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND arraySum(payout_numerators) = payout_denominator
      UNION ALL
      SELECT DISTINCT condition_id FROM default.resolutions_external_ingest
    )
    SELECT condition_id
    FROM wallet_positions wp
    LEFT JOIN resolved r ON wp.condition_id = r.condition_id
    WHERE r.condition_id IS NULL
    ORDER BY condition_id
  `;
  const res = await ch.query({
    query,
    query_params: { wallet: opts.wallet },
    format: 'JSONEachRow',
  });
  const rows = await res.json<{ condition_id: string }[]>();
  return rows.map((row) => row.condition_id);
}

function normalizeConditionId(id: string): string {
  let normalized = id.trim().toLowerCase();
  if (normalized.startsWith('0x')) normalized = normalized.slice(2);
  if (normalized.length !== 64) {
    throw new Error(`Invalid condition id: ${id}`);
  }
  return normalized;
}

function toBytes32(id: string): string {
  return id.startsWith('0x') ? id : `0x${id}`;
}

async function fetchResolutionLog(conditionId: string) {
  const topicCondition = ethers.zeroPadValue(toBytes32(conditionId), 32);
  const logs = await provider.getLogs({
    address: CTF_ADDRESS,
    topics: [CONDITION_RESOLUTION_TOPIC, topicCondition],
    fromBlock: 0,
    toBlock: 'latest',
  });
  if (!logs.length) return undefined;
  const log = logs[logs.length - 1];
  const block = await provider.getBlock(log.blockNumber);
  return { blockNumber: log.blockNumber, timestamp: block?.timestamp ?? 0 };
}

async function fetchPayout(conditionId: string) {
  const bytesId = toBytes32(conditionId);
  const slotCount = Number(await ctf.getOutcomeSlotCount(bytesId));
  if (!slotCount || slotCount < 2) {
    return null;
  }
  const numerators: number[] = [];
  for (let i = 0; i < slotCount; i++) {
    const value = await ctf.payoutNumerators(bytesId, i);
    numerators.push(Number(value));
  }
  const denominator = Number(await ctf.payoutDenominator(bytesId));
  if (!denominator) {
    return null;
  }
  const winningIndex = numerators.findIndex((n) => n === denominator);
  const timestampInfo = await fetchResolutionLog(conditionId).catch(() => undefined);
  return {
    condition_id: conditionId,
    payout_numerators: numerators,
    payout_denominator: denominator,
    winning_index: winningIndex >= 0 ? winningIndex : numerators.indexOf(Math.max(...numerators)),
    resolved_at: timestampInfo?.timestamp ? new Date(timestampInfo.timestamp * 1000) : new Date(),
    block_number: timestampInfo?.blockNumber ?? null,
  };
}

async function insertResolutions(rows: any[]) {
  if (!rows.length) return;
  await ch.insert({
    table: 'default.resolutions_external_ingest',
    values: rows.map((row) => ({
      condition_id: row.condition_id,
      payout_numerators: row.payout_numerators,
      payout_denominator: row.payout_denominator,
      winning_index: row.winning_index,
      resolved_at: row.resolved_at,
      source: 'chain-backfill'
    })),
    format: 'JSONEachRow',
  });
}

async function main() {
  try {
    const opts = parseArgs();
    const conditionIds = await resolveConditionIds(opts);
    if (!conditionIds.length) {
      console.log('No missing condition_ids found.');
      return;
    }
    console.log(`Fetching payouts for ${conditionIds.length} condition_ids...`);
    const rows: any[] = [];
    for (const id of conditionIds) {
      console.log(`  → ${id}`);
      const payout = await fetchPayout(id);
      if (!payout) {
        console.warn(`    ⚠️ No payout data on-chain (yet) for ${id}`);
        continue;
      }
      rows.push(payout);
    }
    await insertResolutions(rows);
    console.log(`Inserted ${rows.length} rows into resolutions_external_ingest.`);
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
