#!/usr/bin/env tsx
/**
 * Apply Supabase Migration: ops_job_checkpoints table
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import pg from 'pg'
import * as fs from 'fs'

const { Pool } = pg

async function main() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL
  })

  try {
    console.log('📋 Applying Supabase migration: ops_job_checkpoints\n')

    const migrationSQL = fs.readFileSync(
      resolve(process.cwd(), 'migrations/supabase/001_create_ops_job_checkpoints.sql'),
      'utf-8'
    )

    await pool.query(migrationSQL)

    console.log('✅ Migration applied successfully\n')

    // Verify table exists
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ops_job_checkpoints'
      ORDER BY ordinal_position
    `)

    console.log('Table schema:')
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`)
    })
    console.log('')

  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
