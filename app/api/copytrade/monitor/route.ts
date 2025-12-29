/**
 * Copy Trade Monitor API
 *
 * GET /api/copytrade/monitor - Get monitor status
 * POST /api/copytrade/monitor - Start/stop/update monitor
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  startMonitor,
  stopMonitor,
  getMonitorStatus,
  updateMonitorConfig,
} from "@/lib/copytrade/priceMonitor";

// ============================================================================
// GET - Monitor Status
// ============================================================================

export async function GET() {
  try {
    const status = getMonitorStatus();

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (err) {
    console.error("[copytrade/monitor] GET error", err);
    return NextResponse.json(
      { success: false, error: "Failed to get monitor status" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Monitor Actions
// ============================================================================

const StartMonitorSchema = z.object({
  action: z.literal("start"),
  config: z.object({
    pollIntervalMs: z.number().min(1000).max(60000).optional(),
    defaultPriceTargetPct: z.number().min(1).max(100).optional(),
    defaultStopLossPct: z.number().min(1).max(100).optional(),
    followWalletExits: z.boolean().optional(),
  }).optional(),
});

const StopMonitorSchema = z.object({
  action: z.literal("stop"),
});

const UpdateConfigSchema = z.object({
  action: z.literal("update_config"),
  config: z.object({
    pollIntervalMs: z.number().min(1000).max(60000).optional(),
    defaultPriceTargetPct: z.number().min(1).max(100).optional(),
    defaultStopLossPct: z.number().min(1).max(100).optional(),
    followWalletExits: z.boolean().optional(),
  }),
});

const RequestSchema = z.union([
  StartMonitorSchema,
  StopMonitorSchema,
  UpdateConfigSchema,
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.parse(body);

    switch (parsed.action) {
      case "start": {
        startMonitor(parsed.config);
        const status = getMonitorStatus();
        return NextResponse.json({
          success: true,
          data: { status },
        });
      }

      case "stop": {
        stopMonitor();
        const status = getMonitorStatus();
        return NextResponse.json({
          success: true,
          data: { status },
        });
      }

      case "update_config": {
        updateMonitorConfig(parsed.config);
        const status = getMonitorStatus();
        return NextResponse.json({
          success: true,
          data: { status },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[copytrade/monitor] POST error", err);

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: err.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Monitor operation failed" },
      { status: 500 }
    );
  }
}
