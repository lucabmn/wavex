import { PULSE_STRIDE_SLOW, usePulse } from "../lib/motion";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/**
 * The phase comes off the shared clock rather than a timer of this component's
 * own: a busy sidebar mounts one of these per running session, and each one
 * used to wake and commit on its own schedule. `PULSE_STRIDE_SLOW` is the 80 ms
 * the spinner has always turned at.
 */
export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-[11px] leading-none",
}: {
  className?: string;
}) {
  const tick = usePulse(PULSE_STRIDE_SLOW);

  return (
    <span aria-hidden className={className}>
      {FRAMES[tick % FRAMES.length]}
    </span>
  );
}
