"use client"

import { useState } from "react"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CANCEL_REASONS } from "../constants"

interface CancelSubscriptionDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string, feedback?: string) => void
}

export function CancelSubscriptionDialog({ isOpen, onClose, onConfirm }: CancelSubscriptionDialogProps) {
  const [selectedReason, setSelectedReason] = useState("")
  const [feedback, setFeedback] = useState("")

  const handleConfirm = () => {
    if (selectedReason) {
      onConfirm(selectedReason, feedback)
      // Reset form after confirmation
      setSelectedReason("")
      setFeedback("")
    }
  }

  const handleClose = () => {
    // Reset form when closing
    setSelectedReason("")
    setFeedback("")
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Subscription</DialogTitle>
          <DialogDescription>
            We&apos;re sorry to see you go. Please help us improve by telling us why you&apos;re cancelling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">Are you sure you want to cancel?</p>
                <p className="text-sm">
                  Your subscription will remain active until the end of your current billing period on June 1, 2025.
                </p>
              </div>
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Please tell us why you&apos;re cancelling so we can improve our service:
            </Label>

            <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
              {CANCEL_REASONS.map((reason) => (
                <div key={reason} className="flex items-center space-x-2">
                  <RadioGroupItem value={reason} id={`reason-${reason}`} />
                  <Label htmlFor={`reason-${reason}`} className="text-sm font-normal">
                    {reason}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback" className="text-sm font-medium">
              Additional feedback (optional)
            </Label>
            <Textarea
              id="feedback"
              placeholder="Tell us more about your experience or what we could do better..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
          <Button variant="outline" onClick={handleClose}>
            Keep Subscription
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!selectedReason}>
            Confirm Cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
