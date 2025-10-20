export const generateReferralLink = (userId: string): string => {
  return `https://defibotx.io/ref/${userId}`
}

export const generateQRCodeUrl = (data: string): string => {
  return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(data)}`
}

export const parseEmailList = (emailString: string): string[] => {
  return emailString
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0)
}

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const validateEmailList = (emailString: string): { valid: string[]; invalid: string[] } => {
  const emails = parseEmailList(emailString)
  const valid: string[] = []
  const invalid: string[] = []

  emails.forEach((email) => {
    if (validateEmail(email)) {
      valid.push(email)
    } else {
      invalid.push(email)
    }
  })

  return { valid, invalid }
}

export const formatProgress = (current: number, total: number): string => {
  return `${current}/${total}`
}

export const calculateProgressPercentage = (current: number, total: number): number => {
  return Math.min((current / total) * 100, 100)
}
