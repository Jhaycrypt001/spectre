"use client";

/**
 * Identity strip for the deployed contract: which contract, which chain, when it went
 * live, and a link out to the public explorer so the numbers below can be checked
 * against the source of truth.
 */

import { Badge } from "@/components/ui/badge";
import type { MarketResponse } from "@/lib/market-types";
import { truncateHex, shortAddress, formatTimestamp } from "@/lib/format";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      {children}
    </div>
  );
}

export function ContractStrip({ data }: { data: MarketResponse }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border/60 bg-card/40 p-5 sm:grid-cols-4">
      <Field label="Contract">
        <a
          href={data.contractUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit font-mono text-sm text-primary underline-offset-4 hover:underline"
          title={data.contractHash}
        >
          {truncateHex(data.contractHash)} ↗
        </a>
      </Field>
      <Field label="Chain">
        <Badge variant="outline" className="w-fit font-mono">
          {data.chainName}
        </Badge>
      </Field>
      <Field label="Deployer">
        <span className="font-mono text-sm" title={data.deployer}>
          {shortAddress(data.deployer)}
        </span>
      </Field>
      <Field label="Live since">
        <span className="font-mono text-sm">
          {formatTimestamp(data.installedAt)}
        </span>
      </Field>
    </div>
  );
}
