#!/usr/bin/env tsx
import { config } from 'dotenv';
import { join } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: join(process.cwd(), '.env.local') });

const projectRef = 'cqvjfonlpqycmaonacvz';
const dbPassword = process.env.SUPABASE_DB_PASSWORD!;

const connectionStrings = [
  {
    name: 'Pooler IPv6 - Session Mode (6543)',
    url: `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Pooler IPv4 - Session Mode (6543)',
    url: `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-east-2-ipv6.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Pooler - Transaction Mode (5432)',
    url: `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`
  }
];

async function testConnection(name: string, connectionString: string) {
  console.log(`\nTesting: ${name}`);
  console.log(`URL: ${connectionString.replace(dbPassword, '****')}`);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    await client.connect();
    console.log('✓ Connected successfully!');

    const result = await client.query('SELECT version()');
    console.log('✓ Query executed:', result.rows[0].version.substring(0, 50) + '...');

    await client.end();
    return true;
  } catch (error: any) {
    console.log('✗ Failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('Testing Supabase connection strings...\n');
  console.log('Project Ref:', projectRef);
  console.log('Region: us-east-2');

  for (const conn of connectionStrings) {
    const success = await testConnection(conn.name, conn.url);
    if (success) {
      console.log('\n✅ WORKING CONNECTION FOUND!');
      console.log('Use this connection string:');
      console.log(conn.url.replace(dbPassword, '${SUPABASE_DB_PASSWORD}'));
      break;
    }
  }
}

main();
