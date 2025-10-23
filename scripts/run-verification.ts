/**
 * Verification Script: Wallet Analytics Tables
 * Runs comprehensive checks on the newly created tables
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TableInfo {
  table_name: string;
  column_count: number;
}

interface IndexInfo {
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface FunctionInfo {
  routine_name: string;
  routine_type: string;
  data_type: string;
}

interface PolicyInfo {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
}

async function verifyTables() {
  console.log('\n' + '='.repeat(70));
  console.log('📊 WALLET ANALYTICS MIGRATION VERIFICATION');
  console.log('='.repeat(70) + '\n');

  // Check Tables
  console.log('1️⃣  TABLES\n');

  const expectedTables = [
    { name: 'wallets', expectedColumns: 23 },
    { name: 'wallet_positions', expectedColumns: 13 },
    { name: 'wallet_trades', expectedColumns: 16 },
    { name: 'wallet_closed_positions', expectedColumns: 14 },
    { name: 'wallet_pnl_snapshots', expectedColumns: 13 },
    { name: 'market_holders', expectedColumns: 11 },
    { name: 'whale_activity_log', expectedColumns: 14 }
  ];

  const { data: tables, error: tablesError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        table_name,
        (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
        AND table_name IN (
          'wallets',
          'wallet_positions',
          'wallet_trades',
          'wallet_closed_positions',
          'wallet_pnl_snapshots',
          'market_holders',
          'whale_activity_log'
        )
      ORDER BY table_name;
    `
  }) as { data: TableInfo[] | null, error: any };

  if (tablesError) {
    console.error('❌ Error checking tables:', tablesError);
  } else if (tables && tables.length > 0) {
    expectedTables.forEach(expected => {
      const found = tables.find((t: TableInfo) => t.table_name === expected.name);
      if (found) {
        const columnMatch = found.column_count === expected.expectedColumns;
        console.log(`   ${columnMatch ? '✅' : '⚠️ '} ${expected.name} (${found.column_count} columns${columnMatch ? '' : `, expected ${expected.expectedColumns}`})`);
      } else {
        console.log(`   ❌ ${expected.name} - NOT FOUND`);
      }
    });
  }

  // Check Indexes
  console.log('\n2️⃣  INDEXES\n');

  const { data: indexes, error: indexesError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        tablename,
        COUNT(*) as index_count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'wallets',
          'wallet_positions',
          'wallet_trades',
          'wallet_closed_positions',
          'wallet_pnl_snapshots',
          'market_holders',
          'whale_activity_log'
        )
      GROUP BY tablename
      ORDER BY tablename;
    `
  }) as { data: any[] | null, error: any };

  const expectedIndexes = {
    wallets: 6,
    wallet_positions: 4,
    wallet_trades: 6,
    wallet_closed_positions: 6,
    wallet_pnl_snapshots: 4,
    market_holders: 5,
    whale_activity_log: 6
  };

  if (indexesError) {
    console.error('❌ Error checking indexes:', indexesError);
  } else if (indexes) {
    Object.entries(expectedIndexes).forEach(([table, count]) => {
      const found = indexes.find((i: any) => i.tablename === table);
      if (found) {
        const match = found.index_count === count;
        console.log(`   ${match ? '✅' : '⚠️ '} ${table} (${found.index_count} indexes${match ? '' : `, expected ${count}`})`);
      } else {
        console.log(`   ❌ ${table} - NO INDEXES FOUND`);
      }
    });
  }

  // Check Functions
  console.log('\n3️⃣  FUNCTIONS\n');

  const expectedFunctions = [
    'update_wallet_timestamp',
    'calculate_wallet_win_rate',
    'get_top_whales',
    'get_suspected_insiders',
    'get_recent_whale_activity'
  ];

  const { data: functions, error: functionsError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN (
          'update_wallet_timestamp',
          'calculate_wallet_win_rate',
          'get_top_whales',
          'get_suspected_insiders',
          'get_recent_whale_activity'
        )
      ORDER BY routine_name;
    `
  }) as { data: any[] | null, error: any };

  if (functionsError) {
    console.error('❌ Error checking functions:', functionsError);
  } else {
    expectedFunctions.forEach(funcName => {
      const found = functions?.find((f: any) => f.routine_name === funcName);
      console.log(`   ${found ? '✅' : '❌'} ${funcName}`);
    });
  }

  // Check RLS Policies
  console.log('\n4️⃣  ROW LEVEL SECURITY POLICIES\n');

  const { data: policies, error: policiesError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT tablename, COUNT(*) as policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'wallets',
          'wallet_positions',
          'wallet_trades',
          'wallet_closed_positions',
          'wallet_pnl_snapshots',
          'market_holders',
          'whale_activity_log'
        )
      GROUP BY tablename
      ORDER BY tablename;
    `
  }) as { data: any[] | null, error: any };

  if (policiesError) {
    console.error('❌ Error checking RLS policies:', policiesError);
  } else if (policies) {
    expectedTables.forEach(table => {
      const found = policies.find((p: any) => p.tablename === table.name);
      if (found && found.policy_count > 0) {
        console.log(`   ✅ ${table.name} (${found.policy_count} ${found.policy_count === 1 ? 'policy' : 'policies'})`);
      } else {
        console.log(`   ⚠️  ${table.name} - NO RLS POLICIES`);
      }
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('✨ VERIFICATION COMPLETE');
  console.log('='.repeat(70) + '\n');
}

verifyTables().catch(console.error);
