import { redirect } from "next/navigation";
import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { getCurrentSessionUser } from "@/lib/auth";

export default async function AdminPage() {
  const user = await getCurrentSessionUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return <PortfolioDashboard adminMode />;
}
