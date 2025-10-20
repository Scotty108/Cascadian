"use client"

import { useState } from "react"
import { Wallet, ChevronDown, Copy, ExternalLink, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatCurrency } from "../../utils"
import type { WalletState } from "../../types"

interface WalletConnectionProps {
  walletState: WalletState
  onConnect: () => void
  onDisconnect: () => void
}

export function WalletConnection({ walletState, onConnect, onDisconnect }: WalletConnectionProps) {
  const [showDetails, setShowDetails] = useState(false)

  const copyAddress = () => {
    if (walletState.address) {
      navigator.clipboard.writeText(walletState.address)
    }
  }

  if (!walletState.isConnected) {
    return (
      <Card>
        <CardHeader className="text-center">
          <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
          <CardTitle>Connect Your Wallet</CardTitle>
          <CardDescription>Connect your wallet to start yield farming and manage your positions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Button onClick={onConnect} className="w-full">
              <Wallet className="mr-2 h-4 w-4" />
              Connect MetaMask
            </Button>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                By connecting your wallet, you agree to our Terms of Service
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex items-center space-x-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="flex items-center space-x-2">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="hidden sm:inline">
                {walletState.address?.slice(0, 6)}...{walletState.address?.slice(-4)}
              </span>
              <span className="font-medium">{formatCurrency(walletState.balance)}</span>
            </div>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium">Wallet Details</h4>
              <Badge variant="outline" className="bg-green-50 text-green-700">
                Connected
              </Badge>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                <div className="flex items-center space-x-2">
                  <code className="text-sm bg-muted px-2 py-1 rounded">{walletState.address}</code>
                  <Button variant="ghost" size="sm" onClick={copyAddress}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="text-lg font-semibold">{formatCurrency(walletState.balance)}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Network</p>
                <div className="flex items-center space-x-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span>Ethereum Mainnet</span>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Supported Tokens</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {walletState.supportedTokens.map((token) => (
                    <Badge key={token} variant="secondary" className="text-xs">
                      {token}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <Separator className="my-3" />

            <div className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <ExternalLink className="mr-2 h-3 w-3" />
                View on Etherscan
              </Button>
              <Button variant="outline" size="sm" onClick={onDisconnect} className="w-full justify-start text-red-600">
                <AlertTriangle className="mr-2 h-3 w-3" />
                Disconnect Wallet
              </Button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
