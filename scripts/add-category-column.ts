/**
 * Add category column to pm_market_metadata table
 *
 * This script adds the category column to the existing table.
 * After running this, you'll need to re-run the ingestion to populate it.
 */

import { clickhouse } from '../lib/clickhouse/client';

async function addCategoryColumn() {
  try {
    console.log('🔧 Adding category column to pm_market_metadata...\n');

    // Add the category column
    await clickhouse.command({
      query: `
        ALTER TABLE pm_market_metadata
        ADD COLUMN IF NOT EXISTS category String DEFAULT ''
        AFTER tags
      `
    });

    console.log('✅ Category column added successfully\n');

    // Verify the schema
    console.log('📋 Verifying updated schema...');
    const result = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_market_metadata',
      format: 'TabSeparated'
    });

    const text = await result.text();
    const lines = text.split('\n');

    console.log('\nTable columns:');
    lines.forEach(line => {
      if (line.trim()) {
        const [name, type] = line.split('\t');
        console.log(`  ${name.padEnd(30)} ${type}`);
      }
    });

    // Check if category was added
    if (text.includes('category\tString')) {
      console.log('\n✅ Category column confirmed in schema');
    } else {
      console.log('\n⚠️  Warning: Category column not found in schema');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addCategoryColumn();
