#!/usr/bin/env npx tsx

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@clickhouse/client";

const envPath = path.resolve("/Users/scotty/Projects/Cascadian-app/.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key] = rest.join("=");
      }
    }
  }
}

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const EGG_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const CONDITION_ID = '340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307';

async function investigate() {
  console.log('\n=== Investigating Egg Market Discrepancy ===\n');
  console.log(`Market: ${CONDITION_ID}`);
  console.log(`Wallet: ${EGG_WALLET}\n`);

  // Check all outcomes for this condition_id
  console.log('Step 1: Check all outcomes in mapping\n');
  const outcomesQuery = `
    SELECT 
      token_id_dec,
      outcome_index,
      question
    FROM pm_token_to_condition_map_v3
    WHERE condition_id = '${CONDITION_ID}'
    ORDER BY outcome_index
  `;
  
  const outcomesResult = await ch.query({
    query: outcomesQuery,
    format: 'JSONEachRow'
  });
  const outcomesText = await outcomesResult.text();
  const outcomes = outcomesText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.table(outcomes);

  // Get ALL trades with details
  console.log('\n\nStep 2: Get ALL trades with full details\n');
  const tradesQuery = `
    SELECT 
      t.event_id,
      formatDateTime(t.trade_time, '%Y-%m-%d %H:%i:%s') as trade_time,
      t.side,
      t.role,
      m.outcome_index,
      t.usdc_amount / 1e6 as usdc_amount,
      t.token_amount / 1e6 as token_amount,
      t.fee_amount / 1e6 as fee_amount,
      CASE WHEN t.side = 'BUY'
           THEN -((t.usdc_amount + t.fee_amount) / 1e6)
           ELSE +((t.usdc_amount - t.fee_amount) / 1e6)
      END as cash_delta,
      CASE WHEN t.side = 'BUY'
           THEN +(t.token_amount / 1e6)
           ELSE -(t.token_amount / 1e6)
      END as shares_delta
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${EGG_WALLET}'
      AND m.condition_id = '${CONDITION_ID}'
    ORDER BY t.trade_time, t.event_id
  `;

  const tradesResult = await ch.query({
    query: tradesQuery,
    format: 'JSONEachRow'
  });
  const tradesText = await tradesResult.text();
  const trades = tradesText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.table(trades);

  // Calculate running totals
  console.log('\n\nStep 3: Running totals by outcome\n');
  const byOutcome = new Map();
  
  for (const trade of trades) {
    const idx = trade.outcome_index;
    if (!byOutcome.has(idx)) {
      byOutcome.set(idx, { outcome_index: idx, cash: 0, shares: 0, count: 0 });
    }
    const state = byOutcome.get(idx);
    state.cash += parseFloat(trade.cash_delta);
    state.shares += parseFloat(trade.shares_delta);
    state.count += 1;
  }

  const summary = Array.from(byOutcome.values());
  console.table(summary);

  // Check what the view thinks
  console.log('\n\nStep 4: What does the view think?\n');
  const viewQuery = `
    SELECT *
    FROM vw_pm_realized_pnl_v5
    WHERE condition_id = '${CONDITION_ID}'
      AND wallet_address = '${EGG_WALLET}'
  `;

  const viewResult = await ch.query({
    query: viewQuery,
    format: 'JSONEachRow'
  });
  const viewText = await viewResult.text();
  const viewData = viewText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.table(viewData);

  await ch.close();
}

investigate().catch(console.error);
