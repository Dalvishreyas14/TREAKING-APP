"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * ThemeProvider is a client component because next-themes must write the theme
 * class onto <html> before paint. The server layout renders <html> with
 * suppressHydrationWarning so there is no flash and no hydration mismatch.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
