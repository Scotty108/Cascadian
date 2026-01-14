"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  DollarSign,
  LayoutGrid,
  Clock,
  Activity,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EventInfo {
  title: string;
  slug: string;
  description: string;
  category: string;
  totalVolume: number;
  marketCount: number;
  closesAt: string;
  image?: string;
}

interface EventHeaderProps {
  event: EventInfo;
}

// Format volume for display
function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(0)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

// Calculate time until close
function getTimeUntilClose(closesAt: string): string {
  if (!closesAt) return "TBD";

  const now = new Date();
  const closeDate = new Date(closesAt);
  const diffMs = closeDate.getTime() - now.getTime();

  if (diffMs <= 0) return "Closed";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (diffDays > 30) {
    return `${Math.floor(diffDays / 30)}mo`;
  }
  if (diffDays > 0) {
    return `${diffDays}d ${diffHours}h`;
  }
  return `${diffHours}h`;
}

// Get category color
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Politics: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Sports: "bg-green-500/20 text-green-400 border-green-500/30",
    Crypto: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    Finance: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    Economy: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    Tech: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    Culture: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    Science: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
  return colors[category] || "bg-muted text-muted-foreground border-border";
}

export function EventHeader({ event }: EventHeaderProps) {
  const timeUntilClose = getTimeUntilClose(event.closesAt);
  const isClosed = timeUntilClose === "Closed";

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
      <div className="container mx-auto px-4 py-4">
        {/* Top Row: Back button and title */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Link href="/events">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold truncate">{event.title}</h1>
              {event.description && (
                <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                  {event.description}
                </p>
              )}
            </div>
          </div>

          {/* Right side: Status badges */}
          <div className="flex items-center gap-2 shrink-0">
            {!isClosed && (
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              >
                <Activity className="h-3 w-3 mr-1" />
                LIVE
              </Badge>
            )}
            <Badge variant="outline" className={cn("border", getCategoryColor(event.category))}>
              {event.category || "Other"}
            </Badge>
          </div>
        </div>

        {/* Bottom Row: Metrics */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{formatVolume(event.totalVolume)}</span>
            <span className="text-muted-foreground">Volume</span>
          </div>

          <div className="flex items-center gap-1.5">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{event.marketCount}</span>
            <span className="text-muted-foreground">Markets</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className={cn("font-semibold", isClosed && "text-muted-foreground")}>
              {timeUntilClose}
            </span>
            <span className="text-muted-foreground">{isClosed ? "" : "Closes"}</span>
          </div>

          <a
            href={`https://polymarket.com/event/${event.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">View on Polymarket</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </header>
  );
}
