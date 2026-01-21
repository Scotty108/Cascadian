#!/usr/bin/env npx tsx
/**
 * Quick Metadata Backfill Script
 *
 * Inserts pre-fetched market data from /tmp/markets_batch_*.json
 * into pm_market_metadata table.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

function normalizeConditionId(conditionId: string | undefined): string {
  if (!conditionId) return '';
  return conditionId.toLowerCase().replace(/^0x/, '');
}

function escape(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\\/g, '\\\\');
}

interface Market {
  conditionId?: string;
  condition_id?: string;
  id?: string;
  slug?: string;
  question?: string;
  groupItemTitle?: string;
  title?: string;
  description?: string;
  image?: string;
  icon?: string;
  category?: string;
  volume?: string;
  volumeNum?: number;
  active?: boolean;
  closed?: boolean;
  clobTokenIds?: string;
  tokens?: { tokenId: string }[];
  outcomes?: string | string[];
  outcomePrices?: any;
  createdAt?: string;
  updatedAt?: string;
  endDate?: string;
  startDate?: string;
}

async function processFile(filePath: string): Promise<number> {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Market[];
  if (!data || data.length === 0) return 0;

  const values: string[] = [];

  for (const raw of data) {
    const conditionId = normalizeConditionId(raw.conditionId || raw.condition_id);
    if (!conditionId) continue;

    // Parse token IDs
    let tokenIds: string[] = [];
    if (Array.isArray(raw.tokens)) {
      tokenIds = raw.tokens.map(t => t.tokenId || '').filter(Boolean);
    } else if (raw.clobTokenIds) {
      try {
        const parsed = JSON.parse(raw.clobTokenIds);
        tokenIds = Array.isArray(parsed) ? parsed : [];
      } catch { tokenIds = []; }
    }

    // Parse outcomes
    let outcomes: string[] = [];
    if (Array.isArray(raw.outcomes)) {
      outcomes = raw.outcomes;
    } else if (typeof raw.outcomes === 'string') {
      try {
        outcomes = JSON.parse(raw.outcomes);
      } catch { outcomes = []; }
    }

    const volume = parseFloat(raw.volume || String(raw.volumeNum) || '0');
    const isActive = raw.active && !raw.closed ? 1 : 0;
    const isClosed = raw.closed ? 1 : 0;

    const tokenIdsArray = `[${tokenIds.map(id => `'${escape(id)}'`).join(', ')}]`;
    const outcomesArray = `[${outcomes.map(o => `'${escape(String(o))}'`).join(', ')}]`;

    const createdAt = raw.createdAt ? `'${raw.createdAt}'` : 'NULL';
    const updatedAt = raw.updatedAt ? `'${raw.updatedAt}'` : 'NULL';
    const endDate = raw.endDate ? `'${raw.endDate}'` : 'NULL';
    const startDate = raw.startDate ? `'${raw.startDate}'` : 'NULL';

    values.push(`(
      '${escape(conditionId)}',
      '${escape(raw.id || '')}',
      '${escape(raw.slug || '')}',
      '${escape(raw.question || '')}',
      '${escape(raw.groupItemTitle || raw.title || '')}',
      '${escape(raw.description || '')}',
      '${escape(raw.image || raw.icon || '')}',
      [],
      '${escape(raw.category || '')}',
      ${volume},
      ${isActive},
      ${isClosed},
      ${endDate},
      ${Date.now()},
      0,
      ${outcomesArray},
      '',
      ${tokenIdsArray},
      '',
      '',
      0, 0, 0,
      '',
      '',
      0, 0, 0, 0, 0,
      ${startDate},
      ${createdAt},
      ${updatedAt},
      '', '', '', '',
      0, 0, 0, 0, 0,
      '', '', 0, 0, 0, 0
    )`);
  }

  if (values.length === 0) return 0;

  const query = `
    INSERT INTO pm_market_metadata (
      condition_id, market_id, slug, question, outcome_label, description, image_url,
      tags, category, volume_usdc, is_active, is_closed, end_date, ingested_at,
      liquidity_usdc, outcomes, outcome_prices, token_ids,
      winning_outcome, resolution_source,
      enable_order_book, order_price_min_tick_size, notifications_enabled,
      event_id, group_slug,
      rewards_min_size, rewards_max_spread, spread, best_bid, best_ask,
      start_date, created_at, updated_at,
      market_type, format_type, lower_bound, upper_bound,
      volume_24hr, volume_1wk, volume_1mo, price_change_1d, price_change_1w,
      series_slug, series_data, comment_count, is_restricted, is_archived, wide_format
    ) VALUES ${values.join(',\n')}
  `;

  await clickhouse.command({ query });
  return values.length;
}

async function main() {
  console.log('Quick Metadata Backfill');
  console.log('='.repeat(50));

  const files = fs.readdirSync('/tmp')
    .filter(f => f.startsWith('markets_batch_') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });

  console.log(`Found ${files.length} batch files`);

  let total = 0;
  for (const file of files) {
    const filePath = path.join('/tmp', file);
    try {
      const count = await processFile(filePath);
      total += count;
      process.stdout.write(`\r  Processed ${file}: ${count} markets (total: ${total})`);
    } catch (err: any) {
      console.error(`\n  Error on ${file}: ${err.message.slice(0, 100)}`);
    }
  }

  console.log(`\n\nTotal inserted: ${total} markets`);

  // Now rebuild token map
  console.log('\nTriggering token map rebuild...');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
