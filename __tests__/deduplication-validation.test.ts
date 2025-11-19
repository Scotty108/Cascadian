/**
 * Deduplication Validation Test Suite
 *
 * Tests to verify deduplication was successful and data integrity maintained
 *
 * Run with: npm test deduplication-validation
 */

import { createClient } from '@clickhouse/client';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'polymarket_canonical'
});

describe('Deduplication Validation', () => {
  afterAll(async () => {
    await client.close();
  });

  describe('Pre-Deduplication Baseline (from backup table)', () => {
    it('should have baseline metrics captured', async () => {
      const result = await client.query({
        query: `
          SELECT
            count(*) AS total_rows,
            count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
            count(DISTINCT wallet) AS unique_wallets,
            min(timestamp) AS earliest,
            max(timestamp) AS latest
          FROM pm_trades_raw_backup
        `,
        format: 'JSONEachRow'
      });

      const baseline = await result.json<any[]>();
      console.log('Baseline metrics:', baseline[0]);

      expect(baseline[0].total_rows).toBeGreaterThan(0);
      expect(baseline[0].unique_keys).toBeGreaterThan(0);
      expect(baseline[0].unique_wallets).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Post-Deduplication State', () => {
    it('should have zero duplicates', async () => {
      const result = await client.query({
        query: `
          SELECT
            transaction_hash,
            log_index,
            count(*) AS dup_count
          FROM pm_trades_raw
          GROUP BY transaction_hash, log_index
          HAVING dup_count > 1
        `,
        format: 'JSONEachRow'
      });

      const duplicates = await result.json<any[]>();
      expect(duplicates.length).toBe(0);
    }, 30000);

    it('should have duplication factor of 1.0', async () => {
      const result = await client.query({
        query: `
          SELECT
            count(*) AS total,
            count(DISTINCT (transaction_hash, log_index)) AS unique_keys,
            total / unique_keys AS dup_factor
          FROM pm_trades_raw
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json<any[]>();
      expect(data[0].dup_factor).toBe(1.0);
    }, 30000);

    it('should preserve all unique transactions', async () => {
      const oldResult = await client.query({
        query: `SELECT count(DISTINCT (transaction_hash, log_index)) AS unique_keys FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT count(DISTINCT (transaction_hash, log_index)) AS unique_keys FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldUnique = (await oldResult.json<any[]>())[0].unique_keys;
      const newUnique = (await newResult.json<any[]>())[0].unique_keys;

      expect(newUnique).toBe(oldUnique);
    }, 30000);

    it('should preserve all wallets', async () => {
      const oldResult = await client.query({
        query: `SELECT count(DISTINCT wallet) AS unique_wallets FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT count(DISTINCT wallet) AS unique_wallets FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldWallets = (await oldResult.json<any[]>())[0].unique_wallets;
      const newWallets = (await newResult.json<any[]>())[0].unique_wallets;

      expect(newWallets).toBe(oldWallets);
    }, 30000);

    it('should preserve date range', async () => {
      const oldResult = await client.query({
        query: `SELECT min(timestamp) AS earliest, max(timestamp) AS latest FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT min(timestamp) AS earliest, max(timestamp) AS latest FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldRange = await oldResult.json<any[]>();
      const newRange = await newResult.json<any[]>();

      expect(newRange[0].earliest).toBe(oldRange[0].earliest);
      expect(newRange[0].latest).toBe(oldRange[0].latest);
    }, 30000);
  });

  describe('XCN Wallet Specific Validation', () => {
    const XCN_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
    const EXPECTED_TRADES = 1299; // From Polymarket API

    it('should have ~1,299 trades for XCN wallet', async () => {
      const result = await client.query({
        query: `SELECT count(*) AS count FROM pm_trades_raw WHERE wallet = '${XCN_WALLET}'`,
        format: 'JSONEachRow'
      });

      const data = await result.json<any[]>();
      const actualCount = data[0].count;

      // Allow 5% tolerance
      expect(actualCount).toBeGreaterThan(EXPECTED_TRADES * 0.95);
      expect(actualCount).toBeLessThan(EXPECTED_TRADES * 1.05);
    }, 30000);

    it('should have zero duplicates for XCN wallet', async () => {
      const result = await client.query({
        query: `
          SELECT count(*) AS dup_count
          FROM (
            SELECT transaction_hash, log_index, count(*) AS c
            FROM pm_trades_raw
            WHERE wallet = '${XCN_WALLET}'
            GROUP BY transaction_hash, log_index
            HAVING c > 1
          )
        `,
        format: 'JSONEachRow'
      });

      const data = await result.json<any[]>();
      expect(data[0].dup_count).toBe(0);
    }, 30000);
  });

  describe('P&L Calculation Integrity', () => {
    it('should have consistent P&L calculations', async () => {
      // Sample wallet for P&L comparison
      const sampleWallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

      const oldPnl = await calculatePnl('pm_trades_raw_backup', sampleWallet);
      const newPnl = await calculatePnl('pm_trades_raw', sampleWallet);

      // P&L should be identical (or very close due to rounding)
      expect(Math.abs(newPnl - oldPnl)).toBeLessThan(0.01); // Within $0.01
    }, 30000);
  });

  describe('Data Quality Metrics', () => {
    it('should have reasonable row count reduction', async () => {
      const oldResult = await client.query({
        query: `SELECT count(*) AS count FROM pm_trades_raw_backup`,
        format: 'JSONEachRow'
      });

      const newResult = await client.query({
        query: `SELECT count(*) AS count FROM pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const oldCount = (await oldResult.json<any[]>())[0].count;
      const newCount = (await newResult.json<any[]>())[0].count;

      const reduction = ((oldCount - newCount) / oldCount) * 100;

      console.log(`Row count reduction: ${reduction.toFixed(2)}%`);
      console.log(`Old: ${oldCount.toLocaleString()} → New: ${newCount.toLocaleString()}`);

      // Should reduce by 80-95% (based on 12,761x duplication)
      expect(reduction).toBeGreaterThan(80);
      expect(reduction).toBeLessThan(95);
    }, 30000);

    it('should have all required columns', async () => {
      const result = await client.query({
        query: `DESCRIBE TABLE pm_trades_raw`,
        format: 'JSONEachRow'
      });

      const schema = await result.json<any[]>();
      const columns = schema.map((s: any) => s.name);

      expect(columns).toContain('transaction_hash');
      expect(columns).toContain('log_index');
      expect(columns).toContain('wallet');
      expect(columns).toContain('timestamp');
      expect(columns).toContain('side');
      expect(columns).toContain('size');
      expect(columns).toContain('price');
    }, 30000);
  });
});

// Helper functions
async function calculatePnl(table: string, wallet: string): Promise<number> {
  const result = await client.query({
    query: `
      SELECT
        sum(CASE
          WHEN side = 'BUY' THEN -price * size
          ELSE price * size
        END) AS net_pnl
      FROM ${table}
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<any[]>();
  return data[0].net_pnl || 0;
}
