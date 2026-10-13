"use server";

import { signOut } from "@/lib/auth";

/**
 * Sign out.
 *
 * Exposed as a server action so the session cookie is cleared server-side. A
 * client-only `signOut()` would leave the app usable until the next reload.
 *
 * `redirectTo` is a fixed literal on purpose: a caller-supplied redirect would
 * let an attacker bounce a user to a hostile origin after signing out.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
