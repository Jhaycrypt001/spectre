import { cn } from "@/lib/utils";

/**
 * Spectre mark: a power bolt cut by a reduction slash. The bolt is the load; the
 * slash is the negawatt — the unit of energy deliberately not consumed.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("size-6", className)}
    >
      <rect
        x="0.75"
        y="0.75"
        width="22.5"
        height="22.5"
        rx="6.25"
        className="fill-primary/10 stroke-primary/30"
        strokeWidth="1.5"
      />
      <path
        d="M12.9 5.5 7.6 13.1h3.6l-.9 5.4 5.3-7.6h-3.6l.9-5.4Z"
        className="fill-primary"
      />
      <path
        d="M6 18.4 18 5.9"
        className="stroke-background"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M6 18.4 18 5.9"
        className="stroke-primary"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
