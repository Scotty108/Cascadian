"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { AlertTriangle, Wallet, ArrowDown, Settings } from "lucide-react"
import type { LiquidityPool } from "../../types"

interface AddLiquidityModalProps {
  pool: LiquidityPool | null
  isOpen: boolean
  onClose: () => void
}

export function AddLiquidityModal({ pool, isOpen, onClose }: AddLiquidityModalProps) {
  const [token1Amount, setToken1Amount] = useState("")
  const [token2Amount, setToken2Amount] = useState("")
  const [slippage, setSlippage] = useState([0.5])
  const [autoApprove, setAutoApprove] = useState(true)
  const [isConnected, setIsConnected] = useState(false)

  if (!pool) return null

  const token1Balance = "1,234.56"
  const token2Balance = "0.8765"
  const priceImpact = "0.12%"
  const minimumReceived = "99.85"

  const handleMaxToken1 = () => {
    setToken1Amount(token1Balance)
    // Auto-calculate token2 amount based on pool ratio
    setToken2Amount((Number.parseFloat(token1Balance) * 0.5).toString())
  }

  const handleMaxToken2 = () => {
    setToken2Amount(token2Balance)
    // Auto-calculate token1 amount based on pool ratio
    setToken1Amount((Number.parseFloat(token2Balance) * 2).toString())
  }

  const handleAddLiquidity = () => {
    // Add liquidity logic here
    console.log("Adding liquidity:", { token1Amount, token2Amount, slippage: slippage[0] })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Liquidity</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Pool Info */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{pool.name}</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline">{pool.protocol}</Badge>
                  <Badge variant="secondary">{pool.apy}</Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Token Inputs */}
          <div className="space-y-4">
            {/* Token 1 */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Label>BTC Amount</Label>
                  <div className="text-sm text-muted-foreground">Balance: {token1Balance} BTC</div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={token1Amount}
                    onChange={(e) => setToken1Amount(e.target.value)}
                    className="text-lg"
                  />
                  <Button variant="outline" onClick={handleMaxToken1}>
                    MAX
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="p-2 border rounded-full bg-background">
                <ArrowDown className="h-4 w-4" />
              </div>
            </div>

            {/* Token 2 */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Label>ETH Amount</Label>
                  <div className="text-sm text-muted-foreground">Balance: {token2Balance} ETH</div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={token2Amount}
                    onChange={(e) => setToken2Amount(e.target.value)}
                    className="text-lg"
                  />
                  <Button variant="outline" onClick={handleMaxToken2}>
                    MAX
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Transaction Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm">Slippage Tolerance</Label>
                  <span className="text-sm font-medium">{slippage[0]}%</span>
                </div>
                <Slider value={slippage} onValueChange={setSlippage} max={5} min={0.1} step={0.1} className="w-full" />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Auto-approve tokens</Label>
                <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
              </div>
            </CardContent>
          </Card>

          {/* Transaction Summary */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Price Impact</span>
                <span className="text-green-600">{priceImpact}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Minimum LP Tokens</span>
                <span>{minimumReceived}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Network Fee</span>
                <span>~$12.50</span>
              </div>
            </CardContent>
          </Card>

          {/* Warning */}
          {Number.parseFloat(priceImpact) > 1 && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">High Price Impact</p>
                  <p className="text-yellow-700 dark:text-yellow-300">
                    This transaction will significantly impact the pool price.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Button */}
          {!isConnected ? (
            <Button className="w-full" onClick={() => setIsConnected(true)}>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
          ) : (
            <Button className="w-full" onClick={handleAddLiquidity} disabled={!token1Amount || !token2Amount}>
              Add Liquidity
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
