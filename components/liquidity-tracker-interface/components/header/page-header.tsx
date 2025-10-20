"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Filter } from "lucide-react"
import { CHAINS, PROTOCOLS, TIME_RANGES } from "../../constants"

interface PageHeaderProps {
  selectedChain: string
  selectedProtocol: string
  timeRange: string
  onChainChange: (value: string) => void
  onProtocolChange: (value: string) => void
  onTimeRangeChange: (value: string) => void
  onToggleAdvancedFilters: () => void
}

export function PageHeader({
  selectedChain,
  selectedProtocol,
  timeRange,
  onChainChange,
  onProtocolChange,
  onTimeRangeChange,
  onToggleAdvancedFilters,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col flex-wrap md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Liquidity Tracker</h1>
        <p className="text-muted-foreground">Track and analyze liquidity across DeFi protocols</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedChain} onValueChange={onChainChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Chain" />
          </SelectTrigger>
          <SelectContent>
            {CHAINS.map((chain) => (
              <SelectItem key={chain.value} value={chain.value}>
                {chain.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedProtocol} onValueChange={onProtocolChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Protocol" />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOLS.map((protocol) => (
              <SelectItem key={protocol.value} value={protocol.value}>
                {protocol.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeRange} onValueChange={onTimeRangeChange}>
          <SelectTrigger className="w-[100px]">
            <SelectValue placeholder="Time Range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value}>
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={onToggleAdvancedFilters}>
          <Filter className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
