"use client";

/**
 * Theme plumbing. next-themes injects a pre-paint inline script that sets the theme
 * class on <html> from localStorage, which is why the root element carries
 * `suppressHydrationWarning` — the DOM intentionally differs from the server markup.
 *
 * `defaultTheme="dark"` because the design system is dark-first; light is the deliberate
 * alternative rather than the baseline.
 */

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
