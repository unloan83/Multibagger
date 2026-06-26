import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { getCurrentSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const user = await getCurrentSessionUser();
  if (user?.role !== "admin") {
    redirect(user?.portfolioName ? `/portfolio/${encodeURIComponent(user.portfolioName)}` : "/login");
  }

  return <PortfolioDashboard adminMode />;
}
