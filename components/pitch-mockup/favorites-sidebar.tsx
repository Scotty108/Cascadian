"use client";

import { useState } from "react";
import { Star, ChevronRight, TrendingUp, Zap, Globe, DollarSign, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Hardcoded favorites for the mockup
const favoriteCategories = [
  {
    name: "Macro Events",
    icon: Globe,
    items: [
      { name: "Fed Rate Cut Dec 2025", probability: 87, trend: "up", isActive: true },
      { name: "ECB Rate Decision Q1", probability: 62, trend: "stable" },
      { name: "US Recession 2025", probability: 23, trend: "down" },
    ],
  },
  {
    name: "Politics",
    icon: Building2,
    items: [
      { name: "2026 Midterms Control", probability: 51, trend: "up" },
      { name: "UK General Election", probability: 45, trend: "stable" },
    ],
  },
  {
    name: "Markets",
    icon: TrendingUp,
    items: [
      { name: "BTC > $150k EOY", probability: 34, trend: "up" },
      { name: "S&P 500 > 6000", probability: 72, trend: "up" },
      { name: "Gold ATH 2025", probability: 58, trend: "stable" },
    ],
  },
  {
    name: "Tech & AI",
    icon: Zap,
    items: [
      { name: "GPT-5 Release 2025", probability: 78, trend: "up" },
      { name: "Apple AI Chip M5", probability: 65, trend: "stable" },
    ],
  },
];

export function FavoritesSidebar() {
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["Macro Events"]);

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  return (
    <div className="w-64 border-r border-border/50 bg-muted/5 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
          <span className="font-semibold text-sm">Watchlist</span>
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto py-2">
        {favoriteCategories.map((category) => {
          const Icon = category.icon;
          const isExpanded = expandedCategories.includes(category.name);

          return (
            <div key={category.name} className="mb-1">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.name)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/50 transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium flex-1 text-left">{category.name}</span>
                <span className="text-xs text-muted-foreground">{category.items.length}</span>
              </button>

              {/* Items */}
              {isExpanded && (
                <div className="ml-6 border-l border-border/30">
                  {category.items.map((item) => (
                    <button
                      key={item.name}
                      className={cn(
                        "w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/50 transition-colors text-left",
                        item.isActive && "bg-primary/10 border-l-2 border-primary -ml-[1px]"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-xs truncate",
                          item.isActive ? "font-semibold text-foreground" : "text-muted-foreground"
                        )}>
                          {item.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={cn(
                          "text-xs font-mono font-bold",
                          item.probability > 70 ? "text-emerald-500" :
                          item.probability > 40 ? "text-amber-500" : "text-rose-500"
                        )}>
                          {item.probability}%
                        </span>
                        {item.trend === "up" && (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        )}
                        {item.trend === "down" && (
                          <TrendingUp className="h-3 w-3 text-rose-500 rotate-180" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <div className="text-xs text-muted-foreground text-center">
          <span className="font-mono">12</span> events tracked
        </div>
      </div>
    </div>
  );
}
