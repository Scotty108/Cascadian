/**
 * Admin API Endpoint for Data Ingestion
 *
 * Triggers the data pipeline manually or via cron job
 *
 * Protected by API key for security
 */

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Verify API key
function verifyApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
  const validKey = process.env.ADMIN_API_KEY || 'change-me-in-production';

  return apiKey === validKey;
}

export async function POST(request: NextRequest) {
  // Verify authorization
  if (!verifyApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'full'; // 'discover', 'process', or 'full'

    console.log(`[Ingest API] Starting action: ${action}`);

    let result: any = {};

    switch (action) {
      case 'discover':
        // Run discovery only
        result = await runDiscovery();
        break;

      case 'process':
        // Run processing only
        result = await runProcessing();
        break;

      case 'full':
      default:
        // Run full pipeline
        result = await runFullPipeline();
        break;
    }

    return NextResponse.json({
      success: true,
      action,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Ingest API] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for cron jobs
  if (!verifyApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Trigger full pipeline
  try {
    const result = await runFullPipeline();

    return NextResponse.json({
      success: true,
      action: 'full',
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function runDiscovery(): Promise<any> {
  console.log('[Discovery] Starting wallet discovery...');

  const { stdout, stderr } = await execAsync(
    'pnpm tsx scripts/discover-all-wallets.ts',
    {
      env: { ...process.env },
      timeout: 300000, // 5 minute timeout
    }
  );

  return {
    type: 'discovery',
    output: stdout,
    errors: stderr || null,
  };
}

async function runProcessing(): Promise<any> {
  console.log('[Processing] Starting wallet processing...');

  const { stdout, stderr } = await execAsync(
    'pnpm tsx scripts/process-wallet-queue.ts',
    {
      env: { ...process.env },
      timeout: 600000, // 10 minute timeout
    }
  );

  return {
    type: 'processing',
    output: stdout,
    errors: stderr || null,
  };
}

async function runFullPipeline(): Promise<any> {
  console.log('[Pipeline] Starting full data pipeline...');

  // Run discovery first
  const discovery = await runDiscovery();

  // Then run processing
  const processing = await runProcessing();

  return {
    type: 'full',
    discovery,
    processing,
  };
}
