#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { execSync } from 'child_process';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';
const TOTAL_SHARDS = parseInt(process.env.SHARDS || '8', 10);

const client = createClient({
  host: CLICKHOUSE_HOST,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
  compression: { response: true },
});

interface WorkerHB {
  worker_id: string;
  last_batch: string;
  updated_at: string;
}

interface CheckpointRow {
  status: string;
  day_idx: number;
}

async function checkWorkerHealth(): Promise<Map<number, number>> {
  try {
    const query = `
      SELECT worker_id, last_batch, updated_at
      FROM worker_heartbeats
      ORDER BY worker_id
    `;
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });
    const text = await result.text();
    if (!text.trim()) {
      return new Map();
    }

    const stalled = new Map<number, number>();
    const lines = text.trim().split('\n');
    const now = Date.now();
    const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    for (const line of lines) {
      const hb = JSON.parse(line) as WorkerHB;
      const workerId = parseInt(hb.worker_id);
      const lastUpdate = new Date(hb.updated_at).getTime();
      const msSinceUpdate = now - lastUpdate;

      if (msSinceUpdate > STALL_THRESHOLD_MS) {
        stalled.set(workerId, msSinceUpdate);
      }
    }

    return stalled;
  } catch {
    return new Map();
  }
}

async function getBackfillProgress(): Promise<{ completed: number; total: number; samples: CheckpointRow[] }> {
  try {
    const query = `
      SELECT status, day_idx
      FROM backfill_checkpoint
      WHERE status = 'COMPLETE'
      ORDER BY day_idx DESC
      LIMIT 10
    `;
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });
    const text = await result.text();
    const samples = text
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CheckpointRow);

    const countQuery = `SELECT countIf(status='COMPLETE') as cnt FROM backfill_checkpoint`;
    const countResult = await client.query({
      query: countQuery,
      format: 'JSON',
    });
    const countText = await countResult.text();
    const countData = JSON.parse(countText);
    const completed = countData.data?.[0]?.cnt || 0;

    return { completed, total: 1048, samples };
  } catch {
    return { completed: 0, total: 1048, samples: [] };
  }
}

async function restartStalledWorker(workerId: number): Promise<void> {
  try {
    console.log(
      `[${new Date().toISOString()}] ⚠️  Worker ${workerId} stalled >5min, attempting restart...`,
    );

    // Kill the stalled worker process
    try {
      execSync(`pkill -f "SHARD_ID=${workerId}"`, { stdio: 'ignore' });
    } catch {
      // Process might already be dead
    }

    await new Promise((r) => setTimeout(r, 1000));

    // Relaunch the worker
    const env = {
      ...process.env,
      SHARDS: String(TOTAL_SHARDS),
      SHARD_ID: String(workerId),
    };

    execSync(`npx tsx ./scripts/step3-streaming-backfill-parallel.ts >> data/backfill/worker-${workerId}.log 2>&1 &`, {
      env,
      stdio: 'ignore',
    });

    console.log(`[${new Date().toISOString()}] ✅ Restarted worker ${workerId}`);
  } catch (error) {
    console.log(`[${new Date().toISOString()}] ❌ Failed to restart worker ${workerId}:`, error);
  }
}

async function monitor(): Promise<void> {
  console.log(`[${new Date().toISOString()}] 🚀 Backfill Monitor Started (checking every 30 sec)`);

  while (true) {
    try {
      const stalled = await checkWorkerHealth();
      const progress = await getBackfillProgress();

      const timestamp = new Date().toISOString();

      if (stalled.size > 0) {
        console.log(`[${timestamp}] ⚠️  Stalled workers: ${Array.from(stalled.keys()).join(', ')}`);
        for (const [workerId] of stalled) {
          await restartStalledWorker(workerId);
        }
      } else {
        console.log(
          `[${timestamp}] ✅ All workers healthy | Progress: ${progress.completed}/${progress.total} days (${Math.round((progress.completed / progress.total) * 100)}%)`,
        );
      }

      // Wait 30 seconds before next check
      await new Promise((r) => setTimeout(r, 30000));
    } catch (error) {
      console.log(`[${new Date().toISOString()}] ❌ Monitor error:`, error);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

monitor().catch((error) => {
  console.log(`[${new Date().toISOString()}] ❌ Fatal monitor error:`, error);
  process.exit(1);
});
