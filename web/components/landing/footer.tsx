import Link from "next/link";

import { Logo } from "@/components/landing/logo";

/**
 * Site footer: brand block, grouped links, and a legal bar.
 *
 * Every link here points somewhere real — a page on this site, the deployed contract
 * on the public explorer, or the source repository. Nothing links to a page that
 * doesn't exist just to fill out a column.
 */

const EXPLORER_BASE = "https://testnet.cspr.live";
const CONTRACT_HASH =
  "fcec0112055f7606cba2755c72d0461ca30aa82a7c6ba740255a32eb7e60af38";
const REPO_URL = "https://github.com/Jhaycrypt001/spectre";
const DOCS_URL =
  "https://claude.ai/code/artifact/7690a5f9-6e1c-48b0-b552-c7e59e2ad0e3";

const GROUPS = [
  {
    heading: "Product",
    links: [
      { label: "Live dashboard", href: "/dashboard" },
      { label: "How it works", href: "/#how" },
      { label: "Mechanism", href: "/#mechanism" },
      { label: "Proof", href: "/#proof" },
    ],
  },
  {
    heading: "Chain",
    links: [
      {
        label: "Contract",
        href: `${EXPLORER_BASE}/contract/${CONTRACT_HASH}`,
        external: true,
      },
      { label: "Casper testnet", href: "https://testnet.cspr.live", external: true },
      { label: "Casper docs", href: "https://docs.casper.network", external: true },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "Docs", href: DOCS_URL, external: true },
      { label: "Source", href: REPO_URL, external: true },
      { label: "FAQ", href: "/#faq" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="w-full border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex w-fit items-center gap-2.5">
              <Logo className="size-6" />
              <span className="text-[0.95rem] font-semibold tracking-tight">
                Spectre
              </span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              A verifiable market for household demand reduction, settled on Casper.
              Every payout is recomputable from chain data.
            </p>
            <span className="shadow-badge inline-flex w-fit items-center gap-2 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Live on Casper testnet
            </span>
          </div>

          {GROUPS.map((group) => (
            <div key={group.heading} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {group.heading}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Spectre. Built for the Casper Agentic
            Buildathon.
          </p>
        </div>
      </div>
    </footer>
  );
}
