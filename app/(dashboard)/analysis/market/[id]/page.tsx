import { MarketDetail } from "@/components/market-detail-interface";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function MarketDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <MarketDetail marketId={id} />;
}
