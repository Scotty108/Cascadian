#!/usr/bin/env tsx
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

const projectRef = 'cqvjfonlpqycmaonacvz';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

async function getConnectionString() {
  console.log('Fetching connection pooler settings...\n');

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/postgres`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    console.error('Failed to fetch:', response.status, response.statusText);
    const text = await response.text();
    console.error(text);
    process.exit(1);
  }

  const data = await response.json();
  console.log('Database config:');
  console.log(JSON.stringify(data, null, 2));
}

getConnectionString();
