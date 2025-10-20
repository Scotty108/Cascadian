"use client"

import { useState, useCallback } from "react"
import { toast } from "@/components/ui/use-toast"
import { validateEmailList } from "../utils"
import type { InvitationFormData } from "../types"
import { DEFAULT_REFERRAL_MESSAGE } from "../constants"

export const useInvitations = () => {
  const [formData, setFormData] = useState<InvitationFormData>({
    emails: "",
    message: DEFAULT_REFERRAL_MESSAGE,
  })
  const [isSending, setIsSending] = useState(false)

  const updateFormData = useCallback((updates: Partial<InvitationFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }))
  }, [])

  const sendInvitations = useCallback(async () => {
    if (!formData.emails.trim()) {
      toast({
        title: "No emails provided",
        description: "Please enter at least one email address.",
        variant: "destructive",
      })
      return
    }

    const { valid, invalid } = validateEmailList(formData.emails)

    if (invalid.length > 0) {
      toast({
        title: "Invalid email addresses",
        description: `Please check these emails: ${invalid.join(", ")}`,
        variant: "destructive",
      })
      return
    }

    setIsSending(true)
    try {
      // In a real app, this would send emails via API
      await new Promise((resolve) => setTimeout(resolve, 2000))

      toast({
        title: "Invitations sent!",
        description: `Your invitation has been sent to ${valid.length} email(s).`,
      })

      setFormData((prev) => ({ ...prev, emails: "" }))
    } catch (error) {
      toast({
        title: "Failed to send invitations",
        description: "Please try again later.",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }, [formData])

  return {
    formData,
    isSending,
    updateFormData,
    sendInvitations,
  }
}
