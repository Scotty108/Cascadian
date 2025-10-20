"use client"

import Image from "next/image";
import { Plus, Zap, Wallet } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState } from "react"
import { formatCurrency } from "../../utils"
import type { UserFarm } from "../../types"

interface MyFarmsGridProps {
  userFarms: UserFarm[]
  onStartFarming?: () => void
  onAddToFarm?: (farmId: number, amount: number) => void
  onHarvestFarm?: (farmId: number) => void
  onWithdrawFromFarm?: (farmId: number, amount: number) => void
}

export function MyFarmsGrid({
  userFarms,
  onStartFarming,
  onAddToFarm,
  onHarvestFarm,
  onWithdrawFromFarm,
}: MyFarmsGridProps) {
  const [selectedFarm, setSelectedFarm] = useState<UserFarm | null>(null)
  const [actionType, setActionType] = useState<"add" | "withdraw" | null>(null)
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleAction = async (farm: UserFarm, type: "add" | "harvest" | "withdraw") => {
    if (type === "harvest") {
      setIsLoading(true)
      try {
        await onHarvestFarm?.(farm.id)
      } finally {
        setIsLoading(false)
      }
      return
    }

    setSelectedFarm(farm)
    setActionType(type)
  }

  const handleSubmitAction = async () => {
    if (!selectedFarm || !actionType || !amount) return

    const numAmount = Number.parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) return

    setIsLoading(true)
    try {
      if (actionType === "add") {
        await onAddToFarm?.(selectedFarm.id, numAmount)
      } else if (actionType === "withdraw") {
        await onWithdrawFromFarm?.(selectedFarm.id, numAmount)
      }

      // Reset form
      setAmount("")
      setSelectedFarm(null)
      setActionType(null)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCloseModal = () => {
    setSelectedFarm(null)
    setActionType(null)
    setAmount("")
  }

  const getMaxAmount = () => {
    if (!selectedFarm) return 0
    return actionType === "withdraw" ? selectedFarm.deposited : 10000 // Assuming max add is $10,000
  }

  if (userFarms.length === 0) {
    return (
      <Card className="flex h-[200px] flex-col items-center justify-center">
        <div className="text-center">
          <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No Active Farms</h3>
          <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have any active yield farming positions yet.</p>
          <Button className="mt-4" onClick={onStartFarming}>
            <Plus className="mr-2 h-4 w-4" />
            Start Farming
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {userFarms.map((farm) => (
          <Card key={farm.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Image
                    src={farm.logo || "/placeholder.svg"}
                    alt={farm.protocol}
                    width={32}
                    height={32}
                    className="mr-2 h-8 w-8 rounded-full"
                  />
                  <div>
                    <CardTitle className="text-base">{farm.protocol}</CardTitle>
                    <CardDescription>{farm.asset}</CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">
                  {farm.apy.toFixed(2)}% APY
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pb-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Deposited</p>
                  <p className="font-medium">{formatCurrency(farm.deposited)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Current Value</p>
                  <p className="font-medium">{formatCurrency(farm.depositValue)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Rewards</p>
                  <p className="font-medium text-green-600">{formatCurrency(farm.rewards)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Time Staked</p>
                  <p className="font-medium">{farm.timeStaked}</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between gap-1 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => handleAction(farm, "add")} disabled={isLoading}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction(farm, "harvest")}
                disabled={isLoading || farm.rewards === 0}
                className={farm.rewards > 0 ? "text-green-600 border-green-200 dark:hover:bg-green-800 hover:bg-green-50" : ""}
              >
                <Zap className="mr-2 h-4 w-4" />
                Harvest
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAction(farm, "withdraw")} disabled={isLoading}>
                Withdraw
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Add/Withdraw Modal */}
      <Dialog open={selectedFarm !== null && actionType !== null} onOpenChange={handleCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === "add" ? "Add to Farm" : "Withdraw from Farm"}</DialogTitle>
          </DialogHeader>

          {selectedFarm && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Image
                  src={selectedFarm.logo || "/placeholder.svg"}
                  alt={selectedFarm.protocol}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full"
                />
                <div>
                  <p className="font-medium">{selectedFarm.protocol}</p>
                  <p className="text-sm text-muted-foreground">{selectedFarm.asset}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount ({actionType === "add" ? "USD" : selectedFarm.asset})</Label>
                <div className="space-y-1">
                  <Input
                    id="amount"
                    type="number"
                    placeholder={`Enter amount to ${actionType}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    max={getMaxAmount()}
                    min="0"
                    step="0.01"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {actionType === "add"
                        ? "Available: $10,000"
                        : `Available: ${formatCurrency(selectedFarm.deposited)}`}
                    </span>
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => setAmount(getMaxAmount().toString())}
                    >
                      Max
                    </button>
                  </div>
                </div>
              </div>

              {actionType === "add" && (
                <div className="rounded-lg bg-blue-50 p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Current APY:</strong> {selectedFarm.apy.toFixed(2)}%
                  </p>
                  <p className="text-xs text-blue-600 mt-1">Adding funds will compound your existing position</p>
                </div>
              )}

              {actionType === "withdraw" && (
                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    <strong>Note:</strong> Withdrawing may affect your rewards
                  </p>
                  <p className="text-xs text-amber-600 mt-1">Consider harvesting rewards before withdrawing</p>
                </div>
              )}

              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  className="flex-1 bg-transparent"
                  onClick={handleCloseModal}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmitAction}
                  disabled={!amount || Number.parseFloat(amount) <= 0 || isLoading}
                >
                  {isLoading ? "Processing..." : `${actionType === "add" ? "Add Funds" : "Withdraw"}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
