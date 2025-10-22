"use client"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { motion } from "framer-motion"

interface AnimatedCardProps {
  children: React.ReactNode
  hoverScale?: number
  hoverGlow?: boolean
  className?: string
}

export function AnimatedCard({
  children,
  className,
  hoverScale = 1.02,
  hoverGlow = false,
}: AnimatedCardProps) {
  return (
    <motion.div
      whileHover={{
        scale: hoverScale,
        transition: { duration: 0.2, ease: "easeOut" }
      }}
      whileTap={{ scale: 0.98 }}
      className={cn("group", className)}
    >
      <Card className={cn(
        "transition-all duration-300",
        hoverGlow && "hover:shadow-[0_0_20px_rgba(0,224,170,0.2)] hover:border-[#00E0AA]/50"
      )}>
        {children}
      </Card>
    </motion.div>
  )
}
