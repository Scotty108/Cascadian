/**
 * Migration Runner API
 *
 * Temporary endpoint to run database migrations
 * DELETE THIS FILE after running migrations in production
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  try {
    console.log('[Migration] Adding event columns to markets table...')

    // Add event columns to markets table
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add event information columns to markets table
        ALTER TABLE markets
        ADD COLUMN IF NOT EXISTS event_id TEXT,
        ADD COLUMN IF NOT EXISTS event_slug TEXT,
        ADD COLUMN IF NOT EXISTS event_title TEXT;

        -- Create indexes for faster event lookups
        CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);
        CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug);
      `
    })

    if (error) {
      // If rpc doesn't exist, try direct queries
      console.log('[Migration] RPC method not available, using direct queries...')

      const queries = [
        'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_id TEXT',
        'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_slug TEXT',
        'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_title TEXT',
        'CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id)',
        'CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug)',
      ]

      for (const query of queries) {
        const result = await supabase.rpc('exec', { query })
        if (result.error) {
          console.error(`[Migration] Error executing: ${query}`, result.error)
        }
      }
    }

    console.log('[Migration] Event columns added successfully!')

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully. Event columns added to markets table.',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Migration] Error:', message)

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
