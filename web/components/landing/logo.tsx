import { cn } from "@/lib/utils";

/**
 * Spectre mark: the angular "S" from the brand logo, framed on a rounded white chip.
 *
 * The source asset (public/brand/spectre-logo.png) is the full lockup — the S sits above
 * a SPECTRE wordmark on white padding. We only want the S here (the wordmark is set as
 * live text beside the mark), so the PNG is used as a background and the box is positioned
 * over just the S: its bounding box is x 36.2–63.6%, y 25.3–61.0% of the 1254×1254 image.
 *
 * A white chip is deliberate: the mark is solid black, which would vanish on the dark
 * theme, so it always rides on its own light tile — crisp and legible in both themes.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block size-6 shrink-0 rounded-[6px] bg-white ring-1 ring-black/10 shadow-sm",
        className,
      )}
      style={{
        backgroundImage: "url(/brand/spectre-logo.png)",
        // Measured S bounding box in the source: x 36.2–63.6%, y 25.3–61.0%
        // (27.4% wide, 35.7% tall), centred at 49.9% / 43.1%. To frame just the S,
        // scale the image so its taller axis (35.7%) plus a little padding fills the
        // chip: 100% / (0.357 × 1.16) ≈ 241%, then centre on the S.
        backgroundSize: "241%",
        backgroundPosition: "49.9% 43.1%",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
