type BadgeVariant = "yes" | "no" | "other" | "accent";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  yes: "bg-yes-soft text-yes",
  no: "bg-no-soft text-no",
  other: "bg-accent-soft text-accent",
  accent: "bg-accent-soft text-accent",
};

export default function Badge({
  children,
  variant = "other",
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}
