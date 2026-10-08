// Renders its children only when a staff session exists.
//
// This is a UI gate, not the security boundary — the RLS policies are. A user
// who bypasses this component still gets nothing from the database, because
// every policy requires `authenticated`. It exists so an unauthenticated
// visitor sees a sign-in screen rather than a broken app full of failed
// queries.
import { useSession } from "@/integrations/supabase/session";
import { SignInPage } from "./SignInPage";
import { Loader2 } from "lucide-react";

export function RequireSession({ children }: { children: React.ReactNode }) {
  const { state } = useSession();

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking session</span>
      </div>
    );
  }

  if (state === "signed-out") {
    return <SignInPage />;
  }

  return <>{children}</>;
}
