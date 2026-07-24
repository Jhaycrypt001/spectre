"use client";

/**
 * Fixed top navigation.
 *
 * Sits above the page with a translucent, blurred backdrop and a hairline bottom
 * border, matching the reference design system. Anchor links scroll to the landing
 * page's sections; the dashboard link is a real route. On small screens the links
 * collapse into a disclosure panel rather than a separate overlay component, which
 * keeps the whole navbar in one file and one state.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/landing/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#proof", label: "Proof" },
  { href: "/#mechanism", label: "Mechanism" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile panel when the viewport grows back to desktop, so the page
  // can't be left with an open panel that no longer has a visible trigger.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        scrolled || open
          ? "border-border bg-background/80 backdrop-blur-xl"
          : "border-transparent bg-background/40 backdrop-blur-sm",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo className="size-6" />
          <span className="text-[0.95rem] font-semibold tracking-tight">
            Spectre
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard">Live dashboard</Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border md:hidden">
          <nav className="mx-auto flex w-full max-w-6xl flex-col px-4 py-2 sm:px-6">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-border/60 py-3 text-sm text-muted-foreground last:border-b-0 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
            <Button asChild size="sm" className="my-3 sm:hidden">
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                Live dashboard
              </Link>
            </Button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
