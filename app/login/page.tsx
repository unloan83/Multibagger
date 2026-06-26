import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect(process.env.LIVEUNLOAN_URL ?? "https://liveunloan.vercel.app");
}
