/**
 * Copy Trade Alerts API
 *
 * GET /api/copytrade/alerts - Fetch alerts
 * POST /api/copytrade/alerts - Mark read, dismiss, create alert
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAlerts,
  getUnreadCount,
  getAlertCounts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  createAlert,
  alertConsensusMet,
  alertPositionOpened,
} from "@/lib/copytrade/alertStore";
import type { AlertType, AlertPriority } from "@/lib/copytrade/alertStore";

// ============================================================================
// GET - Fetch Alerts
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const type = searchParams.get("type") as AlertType | null;
    const priority = searchParams.get("priority") as AlertPriority | null;
    const unreadOnly = searchParams.get("unread") === "true";

    const alerts = getAlerts({
      limit: Math.min(limit, 200),
      type: type || undefined,
      priority: priority || undefined,
      unreadOnly,
    });

    const unreadCount = getUnreadCount();
    const counts = getAlertCounts();

    return NextResponse.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        unreadCount,
        countsByPriority: counts,
      },
    });
  } catch (err) {
    console.error("[copytrade/alerts] GET error", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Alert Actions
// ============================================================================

const MarkReadSchema = z.object({
  action: z.literal("mark_read"),
  alertId: z.string(),
});

const MarkAllReadSchema = z.object({
  action: z.literal("mark_all_read"),
});

const DismissSchema = z.object({
  action: z.literal("dismiss"),
  alertId: z.string(),
});

const CreateAlertSchema = z.object({
  action: z.literal("create"),
  type: z.enum([
    "consensus_triggered",
    "position_opened",
    "exit_triggered",
    "position_resolved",
    "price_alert",
    "wallet_activity",
  ]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  message: z.string(),
  context: z.object({
    positionId: z.string().optional(),
    decisionId: z.string().optional(),
    marketId: z.string().optional(),
    conditionId: z.string().optional(),
    wallets: z.array(z.string()).optional(),
  }).optional(),
});

const RequestSchema = z.union([
  MarkReadSchema,
  MarkAllReadSchema,
  DismissSchema,
  CreateAlertSchema,
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.parse(body);

    switch (parsed.action) {
      case "mark_read": {
        const success = markAlertRead(parsed.alertId);
        return NextResponse.json({
          success,
          data: { alertId: parsed.alertId },
        });
      }

      case "mark_all_read": {
        const count = markAllAlertsRead();
        return NextResponse.json({
          success: true,
          data: { markedCount: count },
        });
      }

      case "dismiss": {
        const success = dismissAlert(parsed.alertId);
        return NextResponse.json({
          success,
          data: { alertId: parsed.alertId },
        });
      }

      case "create": {
        const alert = createAlert(
          parsed.type,
          parsed.priority,
          parsed.title,
          parsed.message,
          parsed.context
        );
        return NextResponse.json({
          success: true,
          data: { alert },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[copytrade/alerts] POST error", err);

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: err.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Alert operation failed" },
      { status: 500 }
    );
  }
}
