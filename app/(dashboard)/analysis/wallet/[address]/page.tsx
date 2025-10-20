import { WalletDetail } from "@/components/wallet-detail-interface";

interface PageProps {
  params: Promise<{
    address: string;
  }>;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { address } = await params;
  return <WalletDetail walletAddress={address} />;
}
