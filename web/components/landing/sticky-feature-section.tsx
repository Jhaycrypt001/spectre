/**
 * The sticky-scroll feature section from the reference design system: a narrow left
 * column that pins while a taller right column of visual panels scrolls past it.
 *
 * The left column carries the claim and stays in view for the whole section, so the
 * reader never loses the thesis while working through the evidence panels on the right.
 * Each panel pairs a rendered artifact with a caption explaining what it shows.
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * Crosshair tick marks at a panel's four corners. The reference draws these as eight
 * hairline bars that overhang the corner by 3 units, so adjacent panels' ticks meet and
 * read as a continuous surveyor's grid rather than as a border.
 */
export function CornerTicks() {
  const bar = "absolute z-40 bg-current text-muted-foreground/50";
  return (
    <div aria-hidden className="pointer-events-none">
      {/* top-left */}
      <div className={cn(bar, "-top-px -left-3 h-px w-3")} />
      <div className={cn(bar, "-top-px left-0 h-px w-3")} />
      <div className={cn(bar, "-top-3 -left-px h-3 w-px")} />
      <div className={cn(bar, "top-0 -left-px h-3 w-px")} />
      {/* top-right */}
      <div className={cn(bar, "-top-px -right-3 h-px w-3")} />
      <div className={cn(bar, "-top-px right-0 h-px w-3")} />
      <div className={cn(bar, "-top-3 -right-px h-3 w-px")} />
      <div className={cn(bar, "top-0 -right-px h-3 w-px")} />
      {/* bottom-left */}
      <div className={cn(bar, "-bottom-px -left-3 h-px w-3")} />
      <div className={cn(bar, "-bottom-px left-0 h-px w-3")} />
      <div className={cn(bar, "-bottom-3 -left-px h-3 w-px")} />
      <div className={cn(bar, "bottom-0 -left-px h-3 w-px")} />
      {/* bottom-right */}
      <div className={cn(bar, "-bottom-px -right-3 h-px w-3")} />
      <div className={cn(bar, "-bottom-px right-0 h-px w-3")} />
      <div className={cn(bar, "-bottom-3 -right-px h-3 w-px")} />
      <div className={cn(bar, "bottom-0 -right-px h-3 w-px")} />
    </div>
  );
}

export interface FeaturePanel {
  /** Short label under the visual, prefixed by an icon. */
  readonly caption: string;
  /** The sentence explaining what the panel demonstrates. */
  readonly body: string;
  readonly icon: React.ReactNode;
  /** The rendered artifact itself. */
  readonly visual: React.ReactNode;
}

export function StickyFeatureSection({
  id,
  title,
  description,
  cta,
  panels,
}: {
  id?: string;
  title: React.ReactNode;
  description: string;
  cta?: { label: string; href: string };
  panels: readonly FeaturePanel[];
}) {
  return (
    <section id={id} className="relative w-full">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-6">
          {/* Pinned claim */}
          <div className="col-span-1 flex flex-col gap-7 p-8 md:col-span-2 md:sticky md:top-20 md:self-start md:p-10 lg:p-14">
            <h3 className="text-left text-3xl font-medium tracking-tighter text-balance lg:text-4xl">
              {title}
            </h3>
            <p className="text-left text-balance text-muted-foreground">
              {description}
            </p>
            {cta ? (
              <Button asChild variant="secondary" className="w-fit border border-border">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            ) : null}
          </div>

          {/* Scrolling evidence */}
          <div className="relative col-span-1 w-full border-t border-border md:col-span-4 md:border-t-0 md:border-l">
            <CornerTicks />
            <div className="w-full divide-y divide-border">
              {panels.map((panel) => (
                <div key={panel.caption} className="relative">
                  <div className="relative flex min-h-[400px] items-center justify-center overflow-visible p-6 md:min-h-[500px] md:p-12">
                    {panel.visual}
                  </div>
                  <div className="max-w-xl items-start p-6 text-left">
                    <p className="flex items-center justify-start gap-3 text-sm text-muted-foreground">
                      {panel.icon}
                      {panel.caption}
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-foreground">
                      {panel.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
