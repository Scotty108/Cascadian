"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Calendar, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"

// Mock data for the selectors
const mockExchanges = [
  { id: "binance", name: "Binance" },
  { id: "coinbase", name: "Coinbase Pro" },
  { id: "kraken", name: "Kraken" },
  { id: "bybit", name: "Bybit" },
]

const mockAccounts = [
  { id: "main", name: "Main Account" },
  { id: "trading", name: "Trading Account" },
  { id: "bot", name: "Bot Account" },
]

const mockMarkets = [
  { id: "spot", name: "Spot Trading" },
  { id: "futures", name: "Futures" },
  { id: "margin", name: "Margin Trading" },
]

const mockTradingPairs = [
  { symbol: "BTC/USDT", name: "Bitcoin / Tether" },
  { symbol: "ETH/USDT", name: "Ethereum / Tether" },
  { symbol: "BNB/USDT", name: "BNB / Tether" },
  { symbol: "ADA/USDT", name: "Cardano / Tether" },
  { symbol: "SOL/USDT", name: "Solana / Tether" },
]

interface TradingSettings {
  tradingView: boolean
  signals: boolean
  fullscreen: boolean
}

interface TradingHeaderProps {
  selectedExchange: string
  selectedAccount: string
  selectedMarket: string
  selectedPair: string
  settings: TradingSettings
  onExchangeChange: (value: string) => void
  onAccountChange: (value: string) => void
  onMarketChange: (value: string) => void
  onPairChange: (value: string) => void
  onSettingChange: (key: keyof TradingSettings, value: boolean) => void
}

export function TradingHeader({
  selectedExchange,
  selectedAccount,
  selectedMarket,
  selectedPair,
  settings,
  onExchangeChange,
  onAccountChange,
  onMarketChange,
  onPairChange,
  onSettingChange,
}: TradingHeaderProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(2024, 4, 15), // May 15, 2024
    to: new Date(2024, 4, 22), // May 22, 2024
  })

  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const formatDateRange = (range: DateRange | undefined): string => {
    if (!range?.from) {
      return "Pick a date range"
    }

    if (range.to) {
      return `${format(range.from, "dd MMM")} - ${format(range.to, "dd MMM")}`
    }

    return format(range.from, "dd MMM")
  }

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDateRange(range)
    // Close the popover when both dates are selected
    if (range?.from && range?.to) {
      setIsCalendarOpen(false)
    }
  }

  return (
    <>
      {/* Exchange Selection */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Exchange</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedExchange} onValueChange={onExchangeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select exchange" />
              </SelectTrigger>
              <SelectContent>
                {mockExchanges.map((exchange) => (
                  <SelectItem key={exchange.id} value={exchange.id}>
                    {exchange.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedAccount} onValueChange={onAccountChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {mockAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Market</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedMarket} onValueChange={onMarketChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent>
                {mockMarkets.map((market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Trading Pair</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedPair} onValueChange={onPairChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select pair" />
              </SelectTrigger>
              <SelectContent>
                {mockTradingPairs.map((pair) => (
                  <SelectItem key={pair.symbol.toLowerCase()} value={pair.symbol.toLowerCase()}>
                    {pair.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {/* Settings Controls */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center gap-4 md:col-span-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="trading-view">Trading View</Label>
            <Switch
              id="trading-view"
              checked={settings.tradingView}
              onCheckedChange={(checked) => onSettingChange("tradingView", checked)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="signals">Signals</Label>
            <Switch
              id="signals"
              checked={settings.signals}
              onCheckedChange={(checked) => onSettingChange("signals", checked)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-8 gap-1 justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>{formatDateRange(dateRange)}</span>
                <ChevronDown className="h-3 w-3 ml-auto opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <CalendarComponent
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={handleDateRangeSelect}
                numberOfMonths={2}
                
                className="rounded-md border"
              />
              <div className="p-3 border-t border-border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {dateRange?.from && dateRange?.to
                      ? `${Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))} days selected`
                      : "Select date range"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDateRange(undefined)
                      setIsCalendarOpen(false)
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </>
  )
}
