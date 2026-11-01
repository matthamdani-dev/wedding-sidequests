import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, isValidAdminToken } from "@/lib/server/admin-session";
import AdminLogin from "@/components/admin-login";
import AdminDashboard from "@/components/admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value;
  const signedIn = isValidAdminToken(token);

  return signedIn ? <AdminDashboard /> : <AdminLogin />;
}
