import { PortfolioDashboard } from "@/components/portfolio-dashboard";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PortfolioDashboard initialPortfolioId={decodeURIComponent(id)} />;
}
