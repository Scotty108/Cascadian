"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { TIER_COLORS } from "./types";

interface WalletHeaderV2Props {
  walletAddress: string;
  username?: string;
  profilePicture?: string;
  tier: string;
  tierLabel: string;
  overallScore: number;
}

export function WalletHeaderV2({
  walletAddress,
  username,
  profilePicture,
  tier,
  tierLabel,
  overallScore,
}: WalletHeaderV2Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortenedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  const tierColors = TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? TIER_COLORS.UNCLASSIFIED;

  // Generate DiceBear avatar as fallback
  const diceBearUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${walletAddress}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Avatar */}
          <Avatar className="h-16 w-16 border-2 border-[#00E0AA]/30">
            <AvatarImage src={profilePicture || diceBearUrl} alt={username || walletAddress} />
            <AvatarFallback className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xl">
              {(username || walletAddress).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {username || shortenedAddress}
              </h1>
              <Badge
                variant="outline"
                className={`${tierColors.bg} ${tierColors.text} ${tierColors.border} font-medium`}
              >
                {tierLabel}
              </Badge>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <code className="text-sm text-muted-foreground font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                {shortenedAddress}
              </code>
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                title="Copy address"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <a
                href={`https://polygonscan.com/address/${walletAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                title="View on Polygonscan"
              >
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          {/* Score badge */}
          <div className="flex flex-col items-center p-4 rounded-xl bg-gradient-to-br from-[#00E0AA]/10 to-[#3B82F6]/10 border border-[#00E0AA]/20">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Score</span>
            <span className="text-3xl font-bold text-[#00E0AA]">{overallScore}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
