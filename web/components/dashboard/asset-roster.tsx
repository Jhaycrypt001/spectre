"use client";

/**
 * The homes registered to sell demand reduction. Each row is one asset: its id, the
 * owner account, its curtailable ceiling, and whether it has a baseline commitment
 * standing (the hash it locked in before the last window).
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AssetStory } from "@/lib/market-types";
import { formatWh, shortAddress, truncateHex } from "@/lib/format";

export function AssetRoster({
  assets,
  className,
}: {
  assets: AssetStory[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Registered homes</CardTitle>
        <CardDescription>
          Assets that can pledge reduction. A commitment is a baseline hash locked
          before a window and revealed at settlement.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/60">
        {assets.map((asset) => (
          <div
            key={asset.assetId}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-sm">{asset.assetId}</span>
              <span
                className="font-mono text-xs text-muted-foreground"
                title={asset.owner}
              >
                {shortAddress(asset.owner)}
              </span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-sm tabular-nums">
                  {formatWh(asset.maxCurtailableW)} W
                </span>
                <span className="text-xs text-muted-foreground">max curtailable</span>
              </div>
              {asset.hasCommitment ? (
                <Badge
                  variant="secondary"
                  className="font-mono"
                  title={asset.lastCommitmentHex}
                >
                  {asset.lastCommitmentHex
                    ? truncateHex(asset.lastCommitmentHex, 5, 5)
                    : "committed"}
                </Badge>
              ) : (
                <Badge variant="outline">no commitment</Badge>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
