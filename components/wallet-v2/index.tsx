"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";

// Data hooks
import { useWalletWIO, TimeWindow } from "@/hooks/use-wallet-wio";
import { useWalletFingerprint } from "@/hooks/use-wallet-fingerprint";
import { useWalletProfile } from "@/hooks/use-wallet-profile";

// New layout components
import { ProfileCard } from "./profile-card";
import { PnLChartCard } from "./pnl-chart-card";
import { StatsRow } from "./stats-row";
import { ContentTabs } from "./content-tabs";

interface WalletProfileV2Props {
  walletAddress: string;
}

export function WalletProfileV2({ walletAddress }: WalletProfileV2Props) {
  const router = useRouter();
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>("ALL");

  // Primary data source: WIO
  const {
    profile: wioProfile,
    isLoading: wioLoading,
    error: wioError,
    score,
    classification,
    metrics: wioMetrics,
    allMetrics,
    categoryStats,
    realizedPnl,
    openPositions,
    recentPositions,
    recentTrades,
  } = useWalletWIO({
    walletAddress,
    window: selectedWindow,
  });

  // Fingerprint data for radar/polar/hex charts
  const {
    metrics: fingerprintMetrics,
    overallScore,
  } = useWalletFingerprint({
    walletAddress,
    window: "90d",
  });

  // Polymarket profile for username/avatar/pnl
  const { profile: polymarketProfile } = useWalletProfile(walletAddress);

  const isLoading = wioLoading;
  const error = wioError;

  // Compute derived values
  const totalPnL = wioMetrics?.pnl_total_usd ?? classification?.pnl_total_usd ?? 0;
  const unrealizedPnL = realizedPnl !== undefined ? totalPnL - realizedPnl : 0;
  const credibility = score?.credibility_score ?? classification?.credibility_score ?? 0;
  const winRate = wioMetrics?.win_rate ?? classification?.win_rate ?? 0;
  const resolvedPositions = wioMetrics?.resolved_positions_n ?? classification?.resolved_positions_n ?? 0;
  const totalPositions = wioMetrics?.positions_n ?? classification?.resolved_positions_n ?? 0;
  const activeDays = wioMetrics?.active_days_n ?? 0;
  const roi = wioMetrics?.roi_cost_weighted;

  // Calculate joined date from wallet age
  const joinedDate = wioMetrics?.wallet_age_days
    ? (() => {
        const d = new Date();
        d.setDate(d.getDate() - wioMetrics.wallet_age_days);
        return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      })()
    : null;

  return (
    <div className="min-h-screen bg-[#F1F1F1] dark:bg-[#0a0a0a] rounded-t-2xl relative z-40">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </motion.div>

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Wallet Data</AlertTitle>
            <AlertDescription>
              {error.message || "Failed to load wallet data"}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && !error && (
          <Card className="p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
              <p className="text-muted-foreground">Loading wallet data...</p>
            </div>
          </Card>
        )}

        {/* Main Content */}
        {!isLoading && !error && wioProfile && (
          <>
            {/* Hero Section: Profile Card + PnL Chart */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              <ProfileCard
                walletAddress={walletAddress}
                username={polymarketProfile?.username}
                profilePicture={polymarketProfile?.profilePicture}
                bio={polymarketProfile?.bio}
                tier={classification?.tier ?? undefined}
                polymarketUrl={polymarketProfile?.polymarketUrl}
                positionsValue={totalPnL > 0 ? totalPnL : undefined}
                biggestWin={undefined}
                predictionsCount={totalPositions}
                joinedDate={joinedDate}
              />
              <PnLChartCard
                walletAddress={walletAddress}
                polymarketUrl={polymarketProfile?.polymarketUrl}
                totalPnl={totalPnL}
                realizedPnl={realizedPnl ?? 0}
                unrealizedPnl={unrealizedPnL}
                polymarketPnl={polymarketProfile?.pnl}
              />
            </motion.div>

            {/* Stats Row */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              <StatsRow
                credibility={credibility}
                tier={classification?.tier ?? undefined}
                winRate={winRate}
                resolvedPositions={resolvedPositions}
              />
            </motion.div>

            {/* Tabbed Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <ContentTabs
                openPositions={openPositions || []}
                closedPositions={recentPositions || []}
                recentTrades={recentTrades || []}
                categoryStats={categoryStats || []}
                fingerprintMetrics={fingerprintMetrics}
                overallScore={overallScore}
                score={score}
                metrics={wioMetrics}
                allMetrics={allMetrics}
                selectedWindow={selectedWindow}
                onWindowChange={setSelectedWindow}
              />
            </motion.div>

            {/* Data Attribution */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              <p className="text-xs text-muted-foreground text-center py-4">
                Data powered by{" "}
                <span className="font-semibold text-[#00E0AA]">WIO</span>{" "}
                (Wallet Intelligence Ontology) • Updated hourly
              </p>
            </motion.div>
          </>
        )}

        {/* Empty State */}
        {!isLoading && !error && !wioProfile && (
          <Card className="p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Wallet Not Found</h3>
              <p className="text-muted-foreground max-w-md">
                This wallet doesn&apos;t have enough trading history in our
                database to generate a profile. Try a wallet with more activity
                on Polymarket.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
