"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatPercent } from "../utils"
import type { StakingPool, StakeFormState } from "../types"

interface StakeDialogProps {
  pool: StakingPool | null
  isOpen: boolean
  onClose: () => void
  formState: StakeFormState
  onFormChange: (state: Partial<StakeFormState>) => void
  onSubmit: () => void
}

export function StakeDialog({ pool, isOpen, onClose, formState, onFormChange, onSubmit }: StakeDialogProps) {
  if (!pool) return null

  const handleSubmit = () => {
    onSubmit()
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={pool.tokenLogo || "/placeholder.svg"} alt={pool.token} />
              <AvatarFallback>{pool.tokenSymbol.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <span>Stake {pool.tokenSymbol}</span>
          </DialogTitle>
          <DialogDescription>
            {pool.name} • {pool.protocol}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="stake-amount">Amount to Stake</Label>
            <div className="relative">
              <Input
                id="stake-amount"
                placeholder="0.0"
                value={formState.amount}
                onChange={(e) => onFormChange({ amount: e.target.value })}
                className="pr-20"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <span className="text-muted-foreground">{pool.tokenSymbol}</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Min: {pool.minStake} {pool.tokenSymbol}
              </span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onFormChange({ amount: "1000" })}>
                Max
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Gas Price</Label>
            <div className="flex space-x-2">
              <Button
                variant={formState.gasOption === "slow" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onFormChange({ gasOption: "slow" })}
              >
                Slow
                <span className="ml-1 text-xs">12 Gwei</span>
              </Button>
              <Button
                variant={formState.gasOption === "standard" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onFormChange({ gasOption: "standard" })}
              >
                Standard
                <span className="ml-1 text-xs">15 Gwei</span>
              </Button>
              <Button
                variant={formState.gasOption === "fast" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onFormChange({ gasOption: "fast" })}
              >
                Fast
                <span className="ml-1 text-xs">20 Gwei</span>
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-compound" className="cursor-pointer">
                Auto-compound Rewards
              </Label>
              <Switch
                id="auto-compound"
                checked={formState.autoCompound}
                onCheckedChange={(checked) => onFormChange({ autoCompound: checked })}
              />
            </div>
            <p className="text-xs text-muted-foreground">Automatically reinvest your rewards to maximize returns</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated APY</span>
              <span className="font-medium text-green-500">{formatPercent(pool.apy)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Lock Period</span>
              <span className="font-medium">{pool.lockPeriodText}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Transaction Fee</span>
              <span className="font-medium">~$2.50</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Stake Now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
