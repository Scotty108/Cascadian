"use client"

import { Key, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface BackupRecoveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BackupRecoveryDialog({ open, onOpenChange }: BackupRecoveryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Backup & Recovery</DialogTitle>
          <DialogDescription>Secure your wallet with backup options</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Backup Options</h3>
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  <span>Export Private Keys</span>
                </div>
                <Button variant="outline" size="sm">
                  Export
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  <span>Download Keystore File</span>
                </div>
                <Button variant="outline" size="sm">
                  Download
                </Button>
              </div>
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-medium">Recovery Phrase</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your 12-word recovery phrase can be used to restore your wallet
            </p>
            <div className="mt-3">
              <Button variant="outline" className="w-full">
                Show Recovery Phrase
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
