import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    console.log('[CRON] Starting unified table refresh...');

    // Run the refresh script
    const { stdout, stderr } = await execAsync(
      'npx tsx scripts/refresh-unified-simple.ts',
      {
        cwd: process.cwd(),
        timeout: 600000, // 10 minutes
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('[CRON] Refresh complete in', elapsed, 'minutes');
    console.log('[CRON] Output:', stdout);

    if (stderr) {
      console.warn('[CRON] Warnings:', stderr);
    }

    return NextResponse.json({
      success: true,
      message: 'Unified table refreshed successfully',
      elapsed_minutes: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
      output: stdout.split('\n').slice(-20).join('\n') // Last 20 lines
    });

  } catch (error: any) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.error('[CRON] Refresh failed after', elapsed, 'minutes:', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      elapsed_minutes: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    }, { status: 500 });
  }
}
