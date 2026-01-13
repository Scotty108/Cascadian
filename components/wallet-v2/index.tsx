"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";

// Use WIO as primary data source
import { useWalletWIO, TimeWindow } from "@/hooks/use-wallet-wio";
import { useWalletFingerprint } from "@/hooks/use-wallet-fingerprint";
import { useWalletProfile } from "@/hooks/use-wallet-profile";

// Import WIO components from wallet-wio
import { WalletHeroSection } from "@/components/wallet-wio/wallet-hero-section";
import { WIOScoreCard } from "@/components/wallet-wio/wio-score-card";
import { PerformanceMetrics } from "@/components/wallet-wio/performance-metrics";
import { PositionsSection } from "@/components/wallet-wio/positions-section";

// Local fingerprint components (unique to wallet-v2)
import { FingerprintSection } from "./fingerprint-section";
import { CoreMetricsGrid } from "./core-metrics-grid";

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
    openPositions,
    recentPositions,
  } = useWalletWIO({
    walletAddress,
    window: selectedWindow,
  });

  // Fingerprint data for radar/polar/hex charts
  const {
    fingerprint,
    metrics: fingerprintMetrics,
    overallScore,
  } = useWalletFingerprint({
    walletAddress,
    window: "90d",
  });

  // Polymarket profile for username/avatar
  const { profile: polymarketProfile } = useWalletProfile(walletAddress);

  const handleWindowChange = (window: TimeWindow) => {
    setSelectedWindow(window);
  };

  const isLoading = wioLoading;
  const error = wioError;

  return (
    <div className="min-h-screen bg-[#F1F1F1] dark:bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
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
              <p className="text-muted-foreground">
                Loading wallet data from WIO...
              </p>
            </div>
          </Card>
        )}

        {/* Main Content */}
        {!isLoading && !error && wioProfile && (
          <>
            {/* Hero Section - Identity + Quick Stats (from WIO) */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <WalletHeroSection
                walletAddress={walletAddress}
                username={polymarketProfile?.username}
                profilePicture={polymarketProfile?.profilePicture}
                bio={polymarketProfile?.bio}
                classification={classification}
                score={score}
                metrics={wioMetrics}
              />
            </motion.div>

            {/* WIO Intelligence Score Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              <WIOScoreCard score={score} />
            </motion.div>

            {/* Fingerprint Visualization (unique to wallet-v2) */}
            {fingerprintMetrics && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.4 }}
              >
                <FingerprintSection
                  metrics={fingerprintMetrics}
                  overallScore={overallScore}
                />
              </motion.div>
            )}

            {/* Performance Metrics with Window Selector */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <PerformanceMetrics
                metrics={wioMetrics}
                allMetrics={allMetrics}
                selectedWindow={selectedWindow}
                onWindowChange={handleWindowChange}
              />
            </motion.div>

            {/* Core Metrics Grid (fingerprint breakdown) */}
            {fingerprintMetrics && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
              >
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                  Fingerprint Breakdown
                </h2>
                <CoreMetricsGrid metrics={fingerprintMetrics} />
              </motion.div>
            )}

            {/* Positions from WIO */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              <PositionsSection
                openPositions={openPositions}
                closedPositions={recentPositions}
              />
            </motion.div>

            {/* Data Attribution */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
            >
              <Card className="p-4 bg-muted/50 border-border/50">
                <p className="text-sm text-muted-foreground text-center">
                  Data powered by{" "}
                  <span className="font-semibold text-[#00E0AA]">WIO</span>{" "}
                  (Wallet Intelligence Ontology) • Updated hourly •{" "}
                  {wioProfile?.computed_at
                    ? `Last computed: ${new Date(wioProfile.computed_at).toLocaleString()}`
                    : ""}
                </p>
              </Card>
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
