"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, Loader2 } from "lucide-react"
import type { BotConfig } from "../../types"

interface DeleteBotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: BotConfig | null
  onConfirm: (botId: string) => Promise<{ success: boolean; error?: string }>
  isLoading: boolean
}

export function DeleteBotModal({ open, onOpenChange, bot, onConfirm, isLoading }: DeleteBotModalProps) {
  const handleConfirm = async () => {
    if (!bot) return

    const result = await onConfirm(bot.id)
    if (result.success) {
      onOpenChange(false)
    }
  }

  if (!bot) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <DialogTitle>Delete Bot</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to delete &quot;{bot.name}&quot;? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
            <h4 className="font-medium text-red-800 dark:text-red-200 mb-2">This will permanently:</h4>
            <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
              <li>• Delete all bot configuration settings</li>
              <li>• Remove trading history and logs</li>
              <li>• Stop any active trading sessions</li>
              <li>• Cancel pending orders (if any)</li>
            </ul>
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Bot Details:</h4>
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">Name:</span> {bot.name}
              </p>
              <p>
                <span className="font-medium">Type:</span> {bot.type}
              </p>
              <p>
                <span className="font-medium">Status:</span> {bot.status}
              </p>
              <p>
                <span className="font-medium">Exchange:</span> {bot.exchange}
              </p>
              <p>
                <span className="font-medium">Trading Pair:</span> {bot.pair}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
