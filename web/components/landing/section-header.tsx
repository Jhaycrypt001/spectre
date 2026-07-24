import { cn } from "@/lib/utils";

/**
 * The section-header pattern used throughout the landing page: a small eyebrow pill,
 * a large tracking-tight heading whose accent phrase carries the radial gradient, and
 * a muted subtitle.
 *
 * Pass the accent phrase as `accent` rather than baking markup into `title`, so the
 * gradient treatment stays consistent everywhere and headings remain plain strings.
 */
export function SectionHeader({
  eyebrow,
  title,
  accent,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
  align?: "center" | "left";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        centered ? "items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "text-3xl font-medium tracking-tighter text-balance md:text-4xl lg:text-6xl",
          centered ? "text-center" : "text-left",
        )}
      >
        {title}
        {accent ? (
          <>
            {" "}
            <GradientText>{accent}</GradientText>
          </>
        ) : null}
      </h2>
      {subtitle ? (
        <p
          className={cn(
            "max-w-2xl text-balance text-muted-foreground",
            centered && "text-center",
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/** Small capsule label that sits above a section heading. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="shadow-badge inline-flex items-center rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** The radial-gradient text treatment applied to a heading's accent phrase. */
export function GradientText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-radial from-gradient-primary to-gradient-secondary bg-clip-text text-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}
