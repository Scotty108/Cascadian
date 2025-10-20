"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"
import { toast } from "@/hooks/use-toast"

interface AddPositionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const protocols = [
  { id: "aave", name: "Aave", type: "Lending", chains: ["Ethereum", "Polygon", "Avalanche"] },
  { id: "uniswap", name: "Uniswap", type: "DEX", chains: ["Ethereum", "Polygon", "Arbitrum"] },
  { id: "curve", name: "Curve", type: "DEX", chains: ["Ethereum", "Polygon"] },
  { id: "compound", name: "Compound", type: "Lending", chains: ["Ethereum"] },
  { id: "pancakeswap", name: "PancakeSwap", type: "DEX", chains: ["BNB Chain"] },
  { id: "sushiswap", name: "SushiSwap", type: "DEX", chains: ["Ethereum", "Polygon"] },
]

const positionTypes = [
  { id: "lending", name: "Lending", description: "Lend assets to earn interest" },
  { id: "liquidity", name: "Liquidity Pool", description: "Provide liquidity to earn fees" },
  { id: "farming", name: "Yield Farming", description: "Stake LP tokens for rewards" },
  { id: "staking", name: "Staking", description: "Stake tokens for rewards" },
]

export function AddPositionModal({ open, onOpenChange }: AddPositionModalProps) {
  const [protocol, setProtocol] = useState("")
  const [chain, setChain] = useState("")
  const [positionType, setPositionType] = useState("")
  const [asset, setAsset] = useState("")
  const [amount, setAmount] = useState("")
  const [value, setValue] = useState("")
  const [apy, setApy] = useState("")
  const [rewards, setRewards] = useState("")

  const selectedProtocol = protocols.find((p) => p.id === protocol)
  const availableChains = selectedProtocol?.chains || []

  const handleAddPosition = () => {
    if (!protocol || !chain || !positionType || !asset || !amount || !value) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    // In a real app, you would add the position to the portfolio
    toast({
      title: "Position added",
      description: `Your ${selectedProtocol?.name} position has been added to your portfolio.`,
    })

    // Reset form
    setProtocol("")
    setChain("")
    setPositionType("")
    setAsset("")
    setAmount("")
    setValue("")
    setApy("")
    setRewards("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add DeFi Position</DialogTitle>
          <DialogDescription>Add a new DeFi position to track in your portfolio.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Position Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Position Type</CardTitle>
              <CardDescription>Select the type of DeFi position</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {positionTypes.map((type) => (
                  <div
                    key={type.id}
                    className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                      positionType === type.id ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setPositionType(type.id)}
                  >
                    <div className="font-medium">{type.name}</div>
                    <div className="text-sm text-muted-foreground">{type.description}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Protocol and Chain Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Protocol & Chain</CardTitle>
              <CardDescription>Select the protocol and blockchain</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="protocol">Protocol *</Label>
                  <Select value={protocol} onValueChange={setProtocol}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select protocol" />
                    </SelectTrigger>
                    <SelectContent>
                      {protocols.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center space-x-2">
                            <span>{p.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {p.type}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chain">Blockchain *</Label>
                  <Select value={chain} onValueChange={setChain} disabled={!protocol}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select chain" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableChains.map((c) => (
                        <SelectItem key={c} value={c.toLowerCase().replace(" ", "-")}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Position Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Position Details</CardTitle>
              <CardDescription>Enter the details of your position</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="asset">Asset/Pair *</Label>
                  <Input
                    id="asset"
                    placeholder="e.g., ETH, ETH/USDC, AAVE"
                    value={asset}
                    onChange={(e) => setAsset(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">The asset or trading pair for this position</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount *</Label>
                  <Input id="amount" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Amount of tokens in the position</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="value">Current Value (USD) *</Label>
                  <Input
                    id="value"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apy">APY (%)</Label>
                  <Input
                    id="apy"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={apy}
                    onChange={(e) => setApy(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rewards">Pending Rewards (USD)</Label>
                <Input
                  id="rewards"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={rewards}
                  onChange={(e) => setRewards(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Current value of unclaimed rewards</p>
              </div>

              {value && apy && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm font-medium mb-2">Estimated Returns</div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Monthly:</span>
                      <span className="ml-2 font-medium">
                        ${((Number.parseFloat(value) * Number.parseFloat(apy)) / 100 / 12).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Yearly:</span>
                      <span className="ml-2 font-medium">
                        ${((Number.parseFloat(value) * Number.parseFloat(apy)) / 100).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">APY:</span>
                      <span className="ml-2 font-medium text-green-500">{apy}%</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAddPosition}
            disabled={!protocol || !chain || !positionType || !asset || !amount || !value}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Position
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
