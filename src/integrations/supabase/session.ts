// Session state for the app.
//
// Only staff (the professor running the room) sign in. The people photographed
// by the cameras are never users — they exist only as rows in `people`.
//
// The auth session is the entire security boundary: once RLS policies are in
// place, an unauthenticated browser can do nothing with the database. This
// module exposes that state to the UI so routes can gate rendering.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";

export type AuthState = "loading" | "signed-in" | "signed-out";

export function useSession(): { state: AuthState; session: Session | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let active = true;

    // getSession resolves the initial state from the persisted token, so we
    // don't flash the sign-in screen for an already-signed-in staff member.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setState(data.session ? "signed-in" : "signed-out");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setState(next ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { state, session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
