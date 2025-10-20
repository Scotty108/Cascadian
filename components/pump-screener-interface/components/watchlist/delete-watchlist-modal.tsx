"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle } from "lucide-react"
import type { WatchlistItem } from "../../types"

interface DeleteWatchlistModalProps {
  isOpen: boolean
  onClose: () => void
  item: WatchlistItem | null
  onConfirm: () => void
}

export function DeleteWatchlistModal({ isOpen, onClose, item, onConfirm }: DeleteWatchlistModalProps) {
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Delete Watchlist Item
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently remove the item from your watchlist.
          </DialogDescription>
        </DialogHeader>

        {item && (
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{item.symbol}</span>
              <Badge variant="outline">{item.exchange}</Badge>
            </div>
            {item.notes && <p className="text-sm text-muted-foreground">{item.notes}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
