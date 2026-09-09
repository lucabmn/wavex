/**
 * The counted filter chip a surface puts above a list.
 *
 * One control rather than a copy per surface, so Activity and Automations read
 * as the same application: the count is what makes a filter worth pressing, and
 * `attention` is the tone for a bucket the user is meant to act on.
 */
export function FilterChip({
  label,
  count,
  active,
  tone = "default",
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Amber, for a bucket that wants a person — waiting, failing. */
  tone?: "default" | "attention";
  onClick: () => void;
}) {
  const attention = tone === "attention" && count > 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] transition-colors ${
        active
          ? attention
            ? "bg-amber-400/15 text-amber-300"
            : "bg-selected text-content"
          : attention
            ? "text-amber-300/80 hover:bg-amber-400/10 hover:text-amber-300"
            : "text-faint hover:bg-hover hover:text-strong"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
