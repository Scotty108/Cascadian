import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * API Route: Apply Polymarket Database Migration
 *
 * Executes the Polymarket schema migration SQL file against Supabase.
 * Uses Supabase REST API with service role key for admin privileges.
 *
 * Usage: GET http://localhost:3000/api/admin/apply-migration
 *
 * Security: This endpoint should be protected in production.
 */
export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    // Read migration SQL file
    const migrationPath = join(process.cwd(), 'supabase/migrations/20251022131000_create_polymarket_tables.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log(`📄 Loaded migration file: ${(sql.length / 1024).toFixed(1)}KB`);

    // Execute SQL via Supabase REST API
    // Using the pgrest endpoint for raw SQL execution
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing Supabase credentials');
    }

    // Use Supabase's query endpoint to execute raw SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      // If exec_sql doesn't exist, try alternative: execute via postgres REST API
      // Split into statements and execute via direct SQL
      console.log('exec_sql not available, trying alternative method...');

      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      console.log(`Found ${statements.length} SQL statements`);

      const results = [];
      for (const statement of statements) {
        if (!statement) continue;

        // Execute via Supabase SQL query
        const stmtResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Profile': 'public'
          },
          body: JSON.stringify({ query: statement + ';' })
        });

        if (!stmtResponse.ok) {
          const error = await stmtResponse.text();
          console.error(`Failed to execute statement:`, statement.substring(0, 100));
          console.error(`Error:`, error);
          results.push({ success: false, error, statement: statement.substring(0, 100) });
        } else {
          results.push({ success: true, statement: statement.substring(0, 100) });
        }
      }

      const duration = Date.now() - startTime;

      return NextResponse.json({
        success: results.every(r => r.success),
        message: 'Migration executed via fallback method',
        results,
        duration_ms: duration
      });
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: 'Migration applied successfully',
      duration_ms: duration,
      sql_size_kb: (sql.length / 1024).toFixed(1)
    });

  } catch (error: any) {
    console.error('Migration failed:', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
