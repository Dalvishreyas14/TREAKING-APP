import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentUser } from "@/lib/auth/guards";
import { TooltipProvider } from "@/components/ui/overlays";

/**
 * Layout for every signed-in screen.
 *
 * `requireUser` here is a convenience, not the security control: proxy.ts already
 * redirects browsers that arrive without a session, and every data path goes
 * through its own guard. This call exists so the shell always has a real name and
 * email to render, and so a revoked session lands on the sign-in screen rather
 * than a half-rendered page.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell name={user.name} email={user.email}>
        {children}
      </AppShell>
    </TooltipProvider>
  );
}
