"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle } from "lucide-react"
import { formatCurrency } from "../../utils"
import type { Asset } from "../../types"

interface RemoveAssetModalProps {
  asset: Asset | null
  isOpen: boolean
  onClose: () => void
  onConfirm: (asset: Asset) => void
  totalBalance: number
}

export function RemoveAssetModal({ asset, isOpen, onClose, onConfirm, totalBalance }: RemoveAssetModalProps) {
  if (!asset) return null

  const assetValue = (asset.allocation / 100) * totalBalance

  const handleConfirm = () => {
    if (!asset) return
    onConfirm(asset)
    onClose()
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle>Remove {asset.symbol} from Portfolio</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-4">
            <p>
              Are you sure you want to remove {asset.symbol} from your portfolio? This will sell your entire position of{" "}
              {formatCurrency(assetValue)}.
            </p>
            <div className="bg-muted p-4 rounded-md space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Asset</span>
                <span className="font-medium">{asset.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Current Price</span>
                <span className="font-medium">{formatCurrency(asset.price)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Allocation</span>
                <span className="font-medium">{asset.allocation}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Value</span>
                <span className="font-medium">{formatCurrency(assetValue)}</span>
              </div>
            </div>
            <p className="text-sm text-destructive font-medium">
              This action cannot be undone. The funds will be converted to your base currency.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remove Asset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
