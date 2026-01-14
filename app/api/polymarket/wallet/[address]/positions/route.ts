/**
 * DEPRECATED: Polymarket Wallet Positions API (External Data-API)
 *
 * This API has been replaced by /api/wio/wallet/[address] (ClickHouse-backed)
 * Returns open positions from WIO data.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Validate address format
  if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid wallet address format. Expected 0x followed by 40 hex characters.',
      },
      { status: 400 }
    );
  }

  // Redirect to WIO wallet endpoint
  const wioUrl = new URL(`/api/wio/wallet/${address}`, request.url);

  return NextResponse.redirect(wioUrl.toString(), { status: 307 });
}
