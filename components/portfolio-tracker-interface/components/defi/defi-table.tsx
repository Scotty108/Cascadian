"use client"

import { useState } from "react"
import { MoreHorizontal, Plus, Minus, Gift, Eye, Bell, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface DefiPosition {
  id: string
  protocol: string
  type: string
  asset: string
  chain: string
  amount: string
  value: string
  apy: string
  rewards: string
  risk: "Low" | "Medium" | "High"
}

const mockDefiPositions: DefiPosition[] = [
  {
    id: "1",
    protocol: "Uniswap V3",
    type: "Liquidity Pool",
    asset: "ETH/USDC",
    chain: "Ethereum",
    amount: "2.5 ETH + 4,250 USDC",
    value: "$8,500.00",
    apy: "12.5%",
    rewards: "$42.50",
    risk: "Medium",
  },
  {
    id: "2",
    protocol: "Compound",
    type: "Lending",
    asset: "USDC",
    chain: "Ethereum",
    amount: "10,000 USDC",
    value: "$10,000.00",
    apy: "4.2%",
    rewards: "$15.30",
    risk: "Low",
  },
  {
    id: "3",
    protocol: "Aave",
    type: "Lending",
    asset: "WETH",
    chain: "Polygon",
    amount: "5.0 WETH",
    value: "$11,250.00",
    apy: "3.8%",
    rewards: "$8.75",
    risk: "Low",
  },
  {
    id: "4",
    protocol: "Curve",
    type: "Liquidity Pool",
    asset: "3CRV",
    chain: "Ethereum",
    amount: "15,000 3CRV",
    value: "$15,150.00",
    apy: "8.9%",
    rewards: "$67.20",
    risk: "Medium",
  },
  {
    id: "5",
    protocol: "Yearn",
    type: "Vault",
    asset: "yvUSDC",
    chain: "Ethereum",
    amount: "8,500 yvUSDC",
    value: "$8,670.00",
    apy: "6.7%",
    rewards: "$23.40",
    risk: "Medium",
  },
]

interface DefiTableProps {
  searchTerm: string
  onSearchChange: (value: string) => void
}

export function DefiTable({ searchTerm, onSearchChange }: DefiTableProps) {
  const [selectedPosition, setSelectedPosition] = useState<DefiPosition | null>(null)
  const [actionType, setActionType] = useState<"deposit" | "withdraw" | "claim" | "details" | "alert" | null>(null)
  const [amount, setAmount] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  // Alert settings
  const [priceAlert, setPriceAlert] = useState(false)
  const [apyAlert, setApyAlert] = useState(false)
  const [rewardsAlert, setRewardsAlert] = useState(false)
  const [priceThreshold, setPriceThreshold] = useState("")
  const [apyThreshold, setApyThreshold] = useState("")
  const [rewardsThreshold, setRewardsThreshold] = useState("")
  const [alertNotes, setAlertNotes] = useState("")

  const filteredPositions = mockDefiPositions.filter(
    (position) =>
      position.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      position.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      position.asset.toLowerCase().includes(searchTerm.toLowerCase()) ||
      position.chain.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleAction = (position: DefiPosition, action: typeof actionType) => {
    setSelectedPosition(position)
    setActionType(action)
    setAmount("")

    // Reset alert settings
    setPriceAlert(false)
    setApyAlert(false)
    setRewardsAlert(false)
    setPriceThreshold("")
    setApyThreshold("")
    setRewardsThreshold("")
    setAlertNotes("")
  }

  const handleCloseModal = () => {
    setSelectedPosition(null)
    setActionType(null)
    setAmount("")
    setIsLoading(false)
  }

  const handleSubmit = async () => {
    if (!selectedPosition) return

    setIsLoading(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))

    setIsLoading(false)
    handleCloseModal()
  }

  const handleClaimRewards = async (position: DefiPosition) => {
    setSelectedPosition(position)
    setActionType("claim")
    setIsLoading(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))

    setIsLoading(false)
    handleCloseModal()
  }

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case "Low":
        return "default"
      case "Medium":
        return "secondary"
      case "High":
        return "destructive"
      default:
        return "default"
    }
  }

  const getMaxAmount = () => {
    if (!selectedPosition) return ""

    if (actionType === "deposit") {
      return "1000" // Available balance for deposit
    } else if (actionType === "withdraw") {
      // Extract numeric value from amount string
      const numericAmount = selectedPosition.amount.match(/[\d,]+\.?\d*/)?.[0]?.replace(/,/g, "") || "0"
      return numericAmount
    }
    return ""
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search DeFi positions..."
            className="w-full md:w-[300px] pl-8"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>APY</TableHead>
              <TableHead>Rewards</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPositions.map((position) => (
              <TableRow key={position.id}>
                <TableCell className="font-medium">{position.protocol}</TableCell>
                <TableCell>{position.type}</TableCell>
                <TableCell>{position.asset}</TableCell>
                <TableCell>{position.chain}</TableCell>
                <TableCell>{position.amount}</TableCell>
                <TableCell>{position.value}</TableCell>
                <TableCell className="text-green-600">{position.apy}</TableCell>
                <TableCell className="text-blue-600">{position.rewards}</TableCell>
                <TableCell>
                  <Badge variant={getRiskBadgeVariant(position.risk)}>{position.risk}</Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleAction(position, "deposit")}>
                        <Plus className="mr-2 h-4 w-4" />
                        Deposit More
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAction(position, "withdraw")}>
                        <Minus className="mr-2 h-4 w-4" />
                        Withdraw
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleClaimRewards(position)}
                        disabled={position.rewards === "$0.00"}
                      >
                        <Gift className="mr-2 h-4 w-4" />
                        Claim Rewards
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAction(position, "details")}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAction(position, "alert")}>
                        <Bell className="mr-2 h-4 w-4" />
                        Set Alert
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Deposit/Withdraw Modal */}
      <Dialog open={actionType === "deposit" || actionType === "withdraw"} onOpenChange={handleCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "deposit" ? "Deposit More" : "Withdraw"} - {selectedPosition?.protocol}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Asset:</span>
                <p className="font-medium">{selectedPosition?.asset}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Current Position:</span>
                <p className="font-medium">{selectedPosition?.amount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">APY:</span>
                <p className="font-medium text-green-600">{selectedPosition?.apy}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Chain:</span>
                <p className="font-medium">{selectedPosition?.chain}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="flex gap-2">
                <Input
                  id="amount"
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Button variant="outline" onClick={() => setAmount(getMaxAmount())}>
                  Max
                </Button>
              </div>
            </div>

            {actionType === "withdraw" && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">Note: Withdrawing will also claim any pending rewards.</p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!amount || isLoading}
                variant={actionType === "withdraw" ? "destructive" : "default"}
              >
                {isLoading ? "Processing..." : actionType === "deposit" ? "Deposit" : "Withdraw"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Claim Rewards Modal */}
      <Dialog open={actionType === "claim"} onOpenChange={handleCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claiming Rewards</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p>Claiming rewards from {selectedPosition?.protocol}...</p>
            <p className="text-sm text-muted-foreground">Rewards: {selectedPosition?.rewards}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Details Modal */}
      <Dialog open={actionType === "details"} onOpenChange={handleCloseModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Position Details - {selectedPosition?.protocol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Protocol</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.protocol}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.type}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Asset</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.asset}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Chain</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.chain}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.amount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Value</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium">{selectedPosition?.value}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">APY</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-medium text-green-600">{selectedPosition?.apy}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Risk Level</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant={getRiskBadgeVariant(selectedPosition?.risk || "")}>{selectedPosition?.risk}</Badge>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pending Rewards</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium text-blue-600">{selectedPosition?.rewards}</p>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set Alert Modal */}
      <Dialog open={actionType === "alert"} onOpenChange={handleCloseModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Alerts - {selectedPosition?.protocol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="price-alert">Price Alert</Label>
                  <p className="text-sm text-muted-foreground">Get notified when price changes</p>
                </div>
                <Switch id="price-alert" checked={priceAlert} onCheckedChange={setPriceAlert} />
              </div>
              {priceAlert && (
                <Input
                  placeholder="Price threshold"
                  value={priceThreshold}
                  onChange={(e) => setPriceThreshold(e.target.value)}
                />
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="apy-alert">APY Alert</Label>
                  <p className="text-sm text-muted-foreground">Get notified when APY changes</p>
                </div>
                <Switch id="apy-alert" checked={apyAlert} onCheckedChange={setApyAlert} />
              </div>
              {apyAlert && (
                <Input
                  placeholder="APY threshold (%)"
                  value={apyThreshold}
                  onChange={(e) => setApyThreshold(e.target.value)}
                />
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="rewards-alert">Rewards Alert</Label>
                  <p className="text-sm text-muted-foreground">Get notified about rewards</p>
                </div>
                <Switch id="rewards-alert" checked={rewardsAlert} onCheckedChange={setRewardsAlert} />
              </div>
              {rewardsAlert && (
                <Input
                  placeholder="Rewards threshold"
                  value={rewardsThreshold}
                  onChange={(e) => setRewardsThreshold(e.target.value)}
                />
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes for this alert..."
                  value={alertNotes}
                  onChange={(e) => setAlertNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={(!priceAlert && !apyAlert && !rewardsAlert) || isLoading}>
                {isLoading ? "Setting..." : "Set Alerts"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
