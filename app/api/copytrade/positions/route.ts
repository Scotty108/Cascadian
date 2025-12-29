/**
 * Copy Trade Positions API
 *
 * GET /api/copytrade/positions - Fetch all paper positions and summary
 * POST /api/copytrade/positions - Create position, close position, resolve
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAllPositions,
  getOpenPositions,
  getPositionSummary,
  getPosition,
  closePosition,
  resolvePosition,
  createPositionFromDecision,
  updatePositionPrice,
} from "@/lib/copytrade/positionStore";
import type { CopyTradeDecision } from "@/lib/contracts/strategyBuilder";

// ============================================================================
// GET - Fetch Positions
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const openOnly = searchParams.get("open") === "true";

    const positions = openOnly ? getOpenPositions() : getAllPositions();
    const summary = getPositionSummary();

    return NextResponse.json({
      success: true,
      data: {
        positions,
        summary,
        count: positions.length,
      },
    });
  } catch (err) {
    console.error("[copytrade/positions] GET error", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch positions" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Position Actions
// ============================================================================

const CreatePositionSchema = z.object({
  action: z.literal("create"),
  decision: z.object({
    decisionId: z.string(),
    timestamp: z.string(),
    sourceWallet: z.string(),
    marketId: z.string(),
    conditionId: z.string(),
    eventSlug: z.string().optional(),
    side: z.enum(["buy", "sell"]),
    outcome: z.string(),
    price: z.number(),
    size: z.number(),
    notionalUsd: z.number().optional(),
    matchedWallets: z.array(z.string()),
    matchedCount: z.number(),
    requiredCount: z.number(),
    consensusKey: z.string(),
    consensusMode: z.enum(["any", "two_agree", "n_of_m", "all"]),
    status: z.string(),
    dryRun: z.boolean(),
  }),
});

const ClosePositionSchema = z.object({
  action: z.literal("close"),
  positionId: z.string(),
  exitPrice: z.number(),
  exitReason: z.enum(["price_target", "stop_loss", "wallet_exit", "manual"]),
});

const ResolvePositionSchema = z.object({
  action: z.literal("resolve"),
  positionId: z.string(),
  resolutionOutcome: z.string(),
  resolutionPrice: z.number(),
});

const UpdatePriceSchema = z.object({
  action: z.literal("update_price"),
  positionId: z.string(),
  currentPrice: z.number(),
});

const RequestSchema = z.union([
  CreatePositionSchema,
  ClosePositionSchema,
  ResolvePositionSchema,
  UpdatePriceSchema,
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.parse(body);

    switch (parsed.action) {
      case "create": {
        const position = createPositionFromDecision(parsed.decision as CopyTradeDecision);
        return NextResponse.json({
          success: true,
          data: { position },
        });
      }

      case "close": {
        const position = closePosition(
          parsed.positionId,
          parsed.exitPrice,
          parsed.exitReason
        );
        if (!position) {
          return NextResponse.json(
            { success: false, error: "Position not found or already closed" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: { position },
        });
      }

      case "resolve": {
        const position = resolvePosition(
          parsed.positionId,
          parsed.resolutionOutcome,
          parsed.resolutionPrice
        );
        if (!position) {
          return NextResponse.json(
            { success: false, error: "Position not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: { position },
        });
      }

      case "update_price": {
        const position = updatePositionPrice(parsed.positionId, parsed.currentPrice);
        if (!position) {
          return NextResponse.json(
            { success: false, error: "Position not found or not open" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: { position },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[copytrade/positions] POST error", err);

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: err.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Position operation failed" },
      { status: 500 }
    );
  }
}
