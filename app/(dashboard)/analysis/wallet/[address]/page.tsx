import { WalletWIOProfile } from "@/components/wallet-wio";

interface PageProps {
  params: Promise<{
    address: string;
  }>;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { address } = await params;
  return <WalletWIOProfile walletAddress={address} />;
}
