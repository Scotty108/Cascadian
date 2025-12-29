"use client";

import { TrendingUp, Users, Clock, Droplets } from "lucide-react";

/**
 * Hero Title Section
 * Large prominent title with event details and key stats
 */
export function HeroTitle() {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* Main Title */}
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Fed Rate Cut December 2025
          </h1>
          <span className="px-2 py-0.5 text-[10px] font-medium text-cyan-500 border border-cyan-500/30 rounded">
            LIVE
          </span>
          <span className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
            Macro / FOMC
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Will the Federal Reserve cut interest rates at the December 2025 FOMC meeting?
        </p>
      </div>

      {/* Stats Row - Horizontal */}
      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-500">Vol</span>
          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">$24.5M</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-500">Traders</span>
          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">45.8K</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-500">Closes</span>
          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">Dec 18</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-zinc-500">Liq</span>
          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">$2.1M</span>
        </div>
      </div>
    </div>
  );
}
