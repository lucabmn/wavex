import type { ComponentType, ReactNode } from "react";

type Props = {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  description: ReactNode;
  children?: ReactNode;
};

/**
 * What a panel surface shows when there is nothing in it yet, or when what was
 * asked for did not arrive. One shape for all of them, so an empty Browser, an
 * empty terminal list, and a page that never loaded read as the same app.
 */
export function SurfacePlaceholder({ icon: Icon, title, description, children }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="size-6 text-content/25" strokeWidth={1.5} />
      {title ? <p className="text-[12.5px] font-medium text-content">{title}</p> : null}
      <p className="max-w-72 text-[12.5px] leading-relaxed text-content/50">{description}</p>
      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-1">{children}</div>
      ) : null}
    </div>
  );
}

export function PlaceholderButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-content/10 px-2.5 py-1 text-[12.5px] text-content transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}
