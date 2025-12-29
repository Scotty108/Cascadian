/**
 * Copy Trade Engine API
 *
 * POST /api/copytrade/engine - Start/stop engine, process test trades
 * GET /api/copytrade/engine - Get engine status
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  initializeEngine,
  stopEngine,
  getEngineState,
  processTradeEvent,
  generateMockTradeEvent,
  parseWalletsCsv,
} from "@/lib/copytrade/manualCopyTradeEngine";
import type { ManualCopyTradeConfig, CopyTradeEvent } from "@/lib/contracts/strategyBuilder";

// ============================================================================
// Request Schemas
// ============================================================================

const StartEngineSchema = z.object({
  action: z.literal("start"),
  config: z.object({
    walletsCsv: z.string(),
    consensusMode: z.enum(["any", "two_agree", "n_of_m", "all"]),
    nRequired: z.number().optional(),
    minSourceNotionalUsd: z.number().optional(),
    maxCopyPerTradeUsd: z.number().optional(),
    dryRun: z.boolean().default(true),
    enableLogging: z.boolean().default(true),
  }),
  allowedConditionIds: z.array(z.string()).optional(),
});

const StopEngineSchema = z.object({
  action: z.literal("stop"),
});

const ProcessTradeSchema = z.object({
  action: z.literal("process_trade"),
  trade: z.object({
    walletAddress: z.string(),
    timestamp: z.string(),
    marketId: z.string(),
    conditionId: z.string(),
    eventSlug: z.string().optional(),
    side: z.enum(["buy", "sell"]),
    outcome: z.string(),
    price: z.number(),
    size: z.number(),
    notionalUsd: z.number().optional(),
  }),
});

const TestConsensusSchema = z.object({
  action: z.literal("test_consensus"),
  wallets: z.array(z.string()),
  conditionId: z.string().optional(),
  side: z.enum(["buy", "sell"]).optional(),
  outcome: z.string().optional(),
});

const RequestSchema = z.union([
  StartEngineSchema,
  StopEngineSchema,
  ProcessTradeSchema,
  TestConsensusSchema,
]);

// ============================================================================
// GET - Engine Status
// ============================================================================

export async function GET() {
  try {
    const state = getEngineState();

    return NextResponse.json({
      success: true,
      data: {
        isRunning: state.isRunning,
        walletCount: state.walletCount,
        bufferSize: state.bufferSize,
        config: state.config ? {
          consensusMode: state.config.consensusMode,
          dryRun: state.config.dryRun,
        } : null,
      },
    });
  } catch (err) {
    console.error("[copytrade/engine] GET error", err);
    return NextResponse.json(
      { success: false, error: "Failed to get engine status" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Engine Actions
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.parse(body);

    switch (parsed.action) {
      case "start": {
        const { config, allowedConditionIds } = parsed;
        const result = initializeEngine(config as ManualCopyTradeConfig, allowedConditionIds);

        if (result.error) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          data: {
            message: "Engine started",
            wallets: result.wallets,
            walletCount: result.wallets.length,
          },
        });
      }

      case "stop": {
        stopEngine();
        return NextResponse.json({
          success: true,
          data: { message: "Engine stopped" },
        });
      }

      case "process_trade": {
        const { trade } = parsed;
        const decision = await processTradeEvent(trade as CopyTradeEvent);

        return NextResponse.json({
          success: true,
          data: {
            decision,
            processed: decision !== null,
          },
        });
      }

      case "test_consensus": {
        // Generate mock trades from each specified wallet
        const { wallets, conditionId, side, outcome } = parsed;
        const decisions = [];

        for (const wallet of wallets) {
          const mockTrade = generateMockTradeEvent(
            wallet,
            conditionId,
            side,
            outcome
          );
          const decision = await processTradeEvent(mockTrade);
          if (decision) {
            decisions.push(decision);
          }
        }

        return NextResponse.json({
          success: true,
          data: {
            tradesProcessed: wallets.length,
            decisions,
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("[copytrade/engine] POST error", err);

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: err.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Engine operation failed" },
      { status: 500 }
    );
  }
}
