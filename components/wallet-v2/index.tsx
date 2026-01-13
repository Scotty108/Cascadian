"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";

import { useWalletFingerprint } from "@/hooks/use-wallet-fingerprint";
import { useWalletProfile } from "@/hooks/use-wallet-profile";

import { WalletHeaderV2 } from "./wallet-header-v2";
import { FingerprintSection } from "./fingerprint-section";
import { CoreMetricsGrid } from "./core-metrics-grid";

interface WalletProfileV2Props {
  walletAddress: string;
}

export function WalletProfileV2({ walletAddress }: WalletProfileV2Props) {
  const router = useRouter();

  // Fetch fingerprint data from WIO
  const {
    fingerprint,
    metrics,
    overallScore,
    tier,
    tierLabel,
    isLoading,
    error,
  } = useWalletFingerprint({
    walletAddress,
    window: "90d",
  });

  // Fetch profile from Polymarket (fallback for username/avatar)
  const { profile: polymarketProfile } = useWalletProfile(walletAddress);

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
              {error.message || "Failed to load wallet fingerprint data"}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && !error && (
          <Card className="p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
              <p className="text-muted-foreground">
                Loading wallet fingerprint...
              </p>
            </div>
          </Card>
        )}

        {/* Main Content */}
        {!isLoading && !error && fingerprint && metrics && (
          <>
            {/* Header */}
            <WalletHeaderV2
              walletAddress={walletAddress}
              username={polymarketProfile?.username}
              profilePicture={polymarketProfile?.profilePicture}
              tier={tier}
              tierLabel={tierLabel}
              overallScore={overallScore}
            />

            {/* Fingerprint Visualization */}
            <FingerprintSection
              metrics={metrics}
              overallScore={overallScore}
            />

            {/* Core Metrics Grid */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                Core Metrics
              </h2>
              <CoreMetricsGrid metrics={metrics} />
            </motion.div>

            {/* Data Attribution */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="text-center text-xs text-muted-foreground py-4"
            >
              Data from Wallet Intelligence Ontology (WIO) • 90-day window •{" "}
              {fingerprint.computed_at
                ? new Date(fingerprint.computed_at).toLocaleString()
                : ""}
            </motion.div>
          </>
        )}

        {/* Empty State */}
        {!isLoading && !error && !fingerprint && (
          <Card className="p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Wallet Not Found</h3>
              <p className="text-muted-foreground max-w-md">
                This wallet doesn&apos;t have enough trading history in our
                database to generate a fingerprint. Try a wallet with more
                activity on Polymarket.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
