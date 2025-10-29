#!/usr/bin/env tsx
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

const projectRef = 'cqvjfonlpqycmaonacvz';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

async function getProjectInfo() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

getProjectInfo();
