"use client";

/**
 * Light/dark switch. Both icons are always mounted and cross-faded by rotate+scale under
 * the `dark:` variant, so the control never reflows and needs no mounted-state guard —
 * the CSS resolves to the right icon at the same moment the theme class lands.
 */

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      className="size-8 cursor-pointer rounded-full"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-[1.1rem] rotate-0 scale-100 text-primary transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-[1.1rem] rotate-90 scale-0 text-primary transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
