"use client"

import { useState, useCallback } from "react"
import { toast } from "@/components/ui/use-toast"

export const useSharing = () => {
  const [copied, setCopied] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast({
        title: "Copied to clipboard!",
        description: "The referral link has been copied to your clipboard.",
      })
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please try copying the link manually.",
        variant: "destructive",
      })
    }
  }, [])

  const shareOnSocial = useCallback((platform: string, url: string, message: string) => {
    const encodedUrl = encodeURIComponent(url)
    const encodedMessage = encodeURIComponent(message)

    let shareUrl = ""

    switch (platform.toLowerCase()) {
      case "twitter":
        shareUrl = `https://twitter.com/intent/tweet?text=${encodedMessage}&url=${encodedUrl}`
        break
      case "facebook":
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
        break
      case "linkedin":
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
        break
      case "telegram":
        shareUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`
        break
      case "whatsapp":
        shareUrl = `https://wa.me/?text=${encodedMessage}%20${encodedUrl}`
        break
      default:
        toast({
          title: `Sharing on ${platform}`,
          description: "Opening sharing dialog...",
        })
        return
    }

    window.open(shareUrl, "_blank", "noopener,noreferrer")
  }, [])

  const toggleQRCode = useCallback(() => {
    setShowQRCode((prev) => !prev)
  }, [])

  return {
    copied,
    showQRCode,
    copyToClipboard,
    shareOnSocial,
    toggleQRCode,
  }
}
