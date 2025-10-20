"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Bot, Copy, Download, Eye, Filter, MoreHorizontal, Pause, Play, Plus, Search, SortAsc, SortDesc, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { ArbitrageBot } from "../types";
import { BotCard } from "./bot-card";

interface BotsTabProps {
  activeBots: ArbitrageBot[];
  pausedBots: ArbitrageBot[];
  stoppedBots: ArbitrageBot[];
  allBots: ArbitrageBot[];
  onCreateBot: () => void;
  onPauseBot: (botId: string) => void;
  onResumeBot: (botId: string) => void;
  onDeleteBot: (botId: string) => void;
  onSelectBot: (botId: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

type SortField = "name" | "profit" | "successRate" | "totalTrades" | "createdAt";
type SortDirection = "asc" | "desc";

export function BotsTab({ activeBots, pausedBots, stoppedBots, allBots, onCreateBot, onPauseBot, onResumeBot, onDeleteBot, onSelectBot, isLoading = false, error = null }: BotsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filterExchange, setFilterExchange] = useState("all");
  const [filterPair, setFilterPair] = useState("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [botToDelete, setBotToDelete] = useState<string | null>(null);

  // Get unique exchanges and pairs for filters
  const uniqueExchanges = Array.from(new Set(allBots.flatMap((bot) => bot.exchanges)));
  const uniquePairs = Array.from(new Set(allBots.flatMap((bot) => bot.pairs)));

  // Filter and sort bots
  const filterBots = (bots: ArbitrageBot[]) => {
    const filtered = bots.filter((bot) => {
      const matchesSearch = bot.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesExchange = filterExchange === "all" || bot.exchanges.includes(filterExchange);
      const matchesPair = filterPair === "all" || bot.pairs.includes(filterPair);

      return matchesSearch && matchesExchange && matchesPair;
    });

    // Sort bots
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "profit":
          aValue = a.totalProfit;
          bValue = b.totalProfit;
          break;
        case "successRate":
          aValue = a.successRate;
          bValue = b.successRate;
          break;
        case "totalTrades":
          aValue = a.totalTrades;
          bValue = b.totalTrades;
          break;
        case "createdAt":
          aValue = a.createdAt.getTime();
          bValue = b.createdAt.getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleDeleteBot = (botId: string) => {
    setBotToDelete(botId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (botToDelete) {
      onDeleteBot(botToDelete);
      setBotToDelete(null);
    }
    setDeleteDialogOpen(false);
  };

  const handleDuplicateBot = (bot: ArbitrageBot) => {
    // Create a copy of the bot with a new name
    const duplicatedBot = {
      ...bot,
      name: `${bot.name} (Copy)`,
      id: undefined, // Will be generated
      status: "stopped" as const,
      totalTrades: 0,
      totalProfit: 0,
      createdAt: new Date(),
    };
    // This would typically call a create function
    console.log("Duplicating bot:", duplicatedBot);
  };

  const exportBotConfig = (bot: ArbitrageBot) => {
    const config = {
      name: bot.name,
      exchanges: bot.exchanges,
      pairs: bot.pairs,
      minSpread: bot.minSpread,
      maxVolume: bot.maxVolume,
      profitThreshold: bot.profitThreshold,
      settings: bot.settings,
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bot.name.replace(/\s+/g, "_")}_config.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const BotActions = ({ bot }: { bot: ArbitrageBot }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onSelectBot(bot.id)}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDuplicateBot(bot)}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportBotConfig(bot)}>
          <Download className="mr-2 h-4 w-4" />
          Export Config
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleDeleteBot(bot.id)} className="text-red-600 focus:text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Bot
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-medium">My Arbitrage Bots</h3>
          <Badge>{allBots.length} Total</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search bots..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 w-[200px]" />
          </div>
          <Select value={filterExchange} onValueChange={setFilterExchange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Exchange" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Exchanges</SelectItem>
              {uniqueExchanges.map((exchange) => (
                <SelectItem key={exchange} value={exchange}>
                  {exchange.charAt(0).toUpperCase() + exchange.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPair} onValueChange={setFilterPair}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Pair" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Pairs</SelectItem>
              {uniquePairs.map((pair) => (
                <SelectItem key={pair} value={pair}>
                  {pair}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="mr-1 h-4 w-4" />
                Sort
                {sortDirection === "asc" ? <SortAsc className="ml-1 h-4 w-4" /> : <SortDesc className="ml-1 h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleSort("name")}>Sort by Name</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("profit")}>Sort by Profit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("successRate")}>Sort by Success Rate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("totalTrades")}>Sort by Total Trades</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("createdAt")}>Sort by Created Date</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="default" size="sm" onClick={onCreateBot} disabled={isLoading}>
            <Plus className="mr-1 h-4 w-4" /> New Bot
          </Button>
        </div>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="min-w-[400px]">
            <TabsTrigger value="all">All Bots</TabsTrigger>
            <TabsTrigger value="active" className="flex items-center gap-1">
              <Play className="h-3 w-3" />
              Active
              <Badge variant="secondary" className="ml-1">
                {filterBots(activeBots).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="paused" className="flex items-center gap-1">
              <Pause className="h-3 w-3" />
              Paused
              <Badge variant="secondary" className="ml-1">
                {filterBots(pausedBots).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="stopped" className="flex items-center gap-1">
              <X className="h-3 w-3" />
              Stopped
              <Badge variant="secondary" className="ml-1">
                {filterBots(stoppedBots).length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterBots(allBots).map((bot) => (
              <div key={bot.id} className="relative">
                <BotCard bot={bot} onPause={onPauseBot} onResume={onResumeBot} />
                <div className="absolute top-2 right-2">
                  <BotActions bot={bot} />
                </div>
              </div>
            ))}
          </div>
          {filterBots(allBots).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bot className="mb-2 h-10 w-10 text-muted-foreground" />
              <h3 className="text-lg font-medium">No bots found</h3>
              <p className="text-sm text-muted-foreground">
                {searchTerm || filterExchange !== "all" || filterPair !== "all" ? "Try adjusting your filters" : "Create your first arbitrage bot to get started"}
              </p>
              {!searchTerm && filterExchange === "all" && filterPair === "all" && (
                <Button className="mt-4" onClick={onCreateBot}>
                  <Plus className="mr-1 h-4 w-4" /> Create Bot
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="active" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterBots(activeBots).map((bot) => (
              <div key={bot.id} className="relative">
                <BotCard bot={bot} onPause={onPauseBot} onResume={onResumeBot} />
                <div className="absolute top-2 right-2">
                  <BotActions bot={bot} />
                </div>
              </div>
            ))}
          </div>
          {filterBots(activeBots).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Play className="mb-2 h-8 w-8 text-muted-foreground" />
              <h3 className="text-lg font-medium">No active bots</h3>
              <p className="text-sm text-muted-foreground">Start a bot to begin arbitrage trading</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="paused" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterBots(pausedBots).map((bot) => (
              <div key={bot.id} className="relative">
                <BotCard bot={bot} onPause={onPauseBot} onResume={onResumeBot} />
                <div className="absolute top-2 right-2">
                  <BotActions bot={bot} />
                </div>
              </div>
            ))}
          </div>
          {filterBots(pausedBots).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Pause className="mb-2 h-8 w-8 text-muted-foreground" />
              <h3 className="text-lg font-medium">No paused bots</h3>
              <p className="text-sm text-muted-foreground">Paused bots will appear here</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="stopped" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filterBots(stoppedBots).map((bot) => (
              <div key={bot.id} className="relative">
                <BotCard bot={bot} onPause={onPauseBot} onResume={onResumeBot} />
                <div className="absolute top-2 right-2">
                  <BotActions bot={bot} />
                </div>
              </div>
            ))}
          </div>
          {filterBots(stoppedBots).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <X className="mb-2 h-8 w-8 text-muted-foreground" />
              <h3 className="text-lg font-medium">No stopped bots</h3>
              <p className="text-sm text-muted-foreground">Stopped bots will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bot</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this bot? This action cannot be undone and all bot data will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete Bot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
