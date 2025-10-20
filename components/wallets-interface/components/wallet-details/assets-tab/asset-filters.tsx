"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NetworkBadge } from "../../shared/network-badge"
import { networks } from "../../../data"

interface AssetFiltersProps {
  activeNetwork: string
  onNetworkChange: (network: string) => void
}

export function AssetFilters({ activeNetwork, onNetworkChange }: AssetFiltersProps) {
  return (
    <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
      <div>
        <h3 className="text-lg font-medium">Assets</h3>
        <p className="text-sm text-muted-foreground">Manage your tokens across different networks</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={activeNetwork} onValueChange={onNetworkChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Network" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Networks</SelectItem>
            {networks.map((network) => (
              <SelectItem key={network.id} value={network.id}>
                <div className="flex items-center gap-2">
                  <NetworkBadge networkId={network.id} size="sm" />
                  <span>{network.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add Token
        </Button>
      </div>
    </div>
  )
}
