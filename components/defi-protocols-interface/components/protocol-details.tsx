"use client"

import { ChevronDown, Shield, Lock, Wallet, ExternalLink, BookmarkCheck } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Protocol } from "../types"
import { CHAINS, RISK_LEVELS } from "../constants"
import { formatCurrency } from "../utils"

interface ProtocolDetailsProps {
  protocol: Protocol
  onClose: () => void
}

export function ProtocolDetails({ protocol, onClose }: ProtocolDetailsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-2xl">{protocol.name}</CardTitle>
          <CardDescription>{protocol.description}</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ChevronDown className="h-4 w-4 rotate-180" />
        </Button>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Value Locked</p>
            <p className="text-2xl font-bold">{formatCurrency(protocol.tvl)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">7-Day Change</p>
            <p className={cn("text-2xl font-bold", protocol.tvlChange > 0 ? "text-green-500" : "text-red-500")}>
              {protocol.tvlChange > 0 ? "+" : ""}
              {protocol.tvlChange}%
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Average APY</p>
            <p className="text-2xl font-bold">{protocol.apy}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Risk Level</p>
            <div className="flex items-center gap-2">
              <div className={cn("h-3 w-3 rounded-full", RISK_LEVELS[protocol.risk]?.color)} />
              <p className="text-xl font-bold">{RISK_LEVELS[protocol.risk]?.label}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-4 text-lg font-medium">Supported Chains</h3>
            <div className="flex flex-wrap gap-2">
              {protocol.chains.map((chainId) => {
                const chain = CHAINS.find((c) => c.id === chainId)
                return (
                  <div key={chainId} className="flex items-center gap-2 rounded-lg border p-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={chain?.icon || "/placeholder.svg"} alt={chain?.name} />
                      <AvatarFallback>{chain?.name.substring(0, 1)}</AvatarFallback>
                    </Avatar>
                    <span>{chain?.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <h3 className="mb-4 text-lg font-medium">Security Status</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-green-500" />
                  <span>Audited</span>
                </div>
                <Badge variant={protocol.audited ? "default" : "outline"}>{protocol.audited ? "Yes" : "No"}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-green-500" />
                  <span>Governance</span>
                </div>
                <Badge variant={protocol.governance ? "default" : "outline"}>
                  {protocol.governance ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="mb-4 text-lg font-medium">Actions</h3>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2">
              <Wallet className="h-4 w-4" />
              <span>Connect Wallet</span>
            </Button>
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              <span>Visit Protocol</span>
            </Button>
            <Button variant="outline" className="gap-2">
              <BookmarkCheck className="h-4 w-4" />
              <span>Add to Watchlist</span>
            </Button>
            <Button variant="outline" className="gap-2">
              <Shield className="h-4 w-4" />
              <span>View Audit Reports</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
