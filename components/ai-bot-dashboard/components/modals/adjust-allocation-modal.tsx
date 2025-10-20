"use client";

import type React from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AlertTriangle } from "lucide-react";
import { useActionState, useOptimistic, useState } from "react";
import type { Asset } from "../../types";
import { formatCurrency } from "../../utils";

interface AdjustAllocationModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (asset: Asset, newAllocation: number) => void;
  totalBalance: number;
}

async function adjustAllocationAction(prevState: any, formData: FormData) {
  const allocation = Number(formData.get("allocation"));

  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (allocation < 0 || allocation > 100) {
    return { success: false, error: "Allocation must be between 0 and 100%" };
  }

  return { success: true, allocation };
}

export function AdjustAllocationModal({ asset, isOpen, onClose, onSave, totalBalance }: AdjustAllocationModalProps) {
  const [allocation, setAllocation] = useState<number>(asset?.allocation || 0);
  const [state, formAction, isPending] = useActionState(adjustAllocationAction, { success: false, allocation: 0 });

  // Optimistic updates for allocation changes
  const [optimisticAllocation, setOptimisticAllocation] = useOptimistic(allocation, (currentAllocation, newAllocation: number) => newAllocation);

  // Reset allocation when asset changes
  if (asset && allocation !== asset.allocation) {
    setAllocation(asset.allocation);
  }

  const handleAllocationChange = (value: number[]) => {
    const newAllocation = value[0];
    setAllocation(newAllocation);
    setOptimisticAllocation(newAllocation);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      setAllocation(value);
      setOptimisticAllocation(value);
    }
  };

  const handleFormAction = async (formData: FormData) => {
    console.log(formData);
  };

  if (!asset) return null;

  const allocationValue = (optimisticAllocation / 100) * totalBalance;
  const allocationDifference = optimisticAllocation - asset.allocation;
  const showWarning = allocationDifference > 10 || allocationDifference < -10;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Adjust Allocation for {asset.symbol}</DialogTitle>
          <DialogDescription>
            Current allocation: {asset.allocation}% ({formatCurrency((asset.allocation / 100) * totalBalance)})
          </DialogDescription>
        </DialogHeader>

        <form action={handleFormAction}>
          <div className="space-y-6 py-4">
            {showWarning && (
              <Alert className="bg-yellow-50 text-yellow-800 border-yellow-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  You&apos;re about to make a significant change ({allocationDifference > 0 ? "+" : ""}
                  {allocationDifference.toFixed(2)}%). This may impact your portfolio balance.
                </AlertDescription>
              </Alert>
            )}

            {state?.error && (
              <Alert className="bg-red-50 text-red-800 border-red-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="allocation">Allocation Percentage</Label>
                <span className="text-sm text-muted-foreground">{optimisticAllocation}%</span>
              </div>
              <Slider id="allocation-slider" min={0} max={100} step={0.5} value={[optimisticAllocation]} onValueChange={handleAllocationChange} className="py-4" />
              <div className="flex items-center gap-2">
                <Input name="allocation" id="allocation" type="number" min={0} max={100} step={0.5} value={optimisticAllocation} onChange={handleInputChange} className="w-24" />
                <span className="text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Allocation Value</Label>
              <div className="text-lg font-medium">{formatCurrency(allocationValue)}</div>
              <div className={`text-sm ${allocationDifference >= 0 ? "text-green-600" : "text-red-600"}`}>
                {allocationDifference >= 0 ? "+" : ""}
                {formatCurrency((allocationDifference / 100) * totalBalance)}({allocationDifference >= 0 ? "+" : ""}
                {allocationDifference.toFixed(2)}%)
              </div>
            </div>

            <div className="space-y-2">
              <Label>Impact on Other Assets</Label>
              <p className="text-sm text-muted-foreground">
                {allocationDifference > 0 ? `Other assets will be reduced proportionally to accommodate this increase.` : `Other assets will be increased proportionally to accommodate this decrease.`}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
