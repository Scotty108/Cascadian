/**
 * Admin API: Add Event Columns to Markets Table
 *
 * One-time endpoint to add event_id, event_slug, event_title columns
 * Run this once, then delete this file
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  try {
    console.log('[Admin] Adding event columns to markets table...')

    // Execute each ALTER TABLE statement separately
    const commands = [
      'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_id TEXT',
      'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_slug TEXT',
      'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_title TEXT',
    ]

    for (const sql of commands) {
      console.log('[Admin] Executing:', sql)
      const { error } = await supabase.rpc('exec', { sql })

      if (error) {
        // Try direct query as fallback
        console.log('[Admin] RPC failed, trying direct query...')
        const { error: directError } = await (supabase as any).from('_sqlQuery').insert({ query: sql })
        if (directError) {
          console.error('[Admin] Direct query also failed:', directError)
          throw new Error(`Failed to execute: ${sql}. Error: ${directError.message || error.message}`)
        }
      }
    }

    // Create indexes
    const indexCommands = [
      'CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id)',
      'CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug)',
    ]

    for (const sql of indexCommands) {
      console.log('[Admin] Executing:', sql)
      try {
        await supabase.rpc('exec', { sql })
      } catch (err: any) {
        console.warn('[Admin] Index creation skipped (may already exist):', err.message)
      }
    }

    console.log('[Admin] Event columns added successfully!')

    return NextResponse.json({
      success: true,
      message: 'Event columns added to markets table. You can now delete this API endpoint.',
      columns_added: ['event_id', 'event_slug', 'event_title'],
      indexes_added: ['idx_markets_event_id', 'idx_markets_event_slug'],
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Admin] Error:', message)

    return NextResponse.json(
      {
        success: false,
        error: message,
        note: 'You may need to run this migration manually via Supabase dashboard SQL editor',
        sql_commands: [
          'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_id TEXT;',
          'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_slug TEXT;',
          'ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_title TEXT;',
          'CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);',
          'CREATE INDEX IF NOT EXISTS idx_markets_event_slug ON markets(event_slug);',
        ],
      },
      { status: 500 }
    )
  }
}
