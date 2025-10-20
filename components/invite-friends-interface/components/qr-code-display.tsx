import Image from "next/image";
import { generateQRCodeUrl } from "../utils"

interface QRCodeDisplayProps {
  data: string
  size?: number
}

export function QRCodeDisplay({ data, size = 150 }: QRCodeDisplayProps) {
  const qrCodeUrl = generateQRCodeUrl(data)

  return (
    <div className="flex justify-center py-4">
      <div className="bg-white p-4 rounded-lg">
        <Image
          src={qrCodeUrl || "/placeholder.svg"}
          alt="QR Code for referral link"
          width={size}
          height={size}
          className="block"
        />
      </div>
    </div>
  )
}
