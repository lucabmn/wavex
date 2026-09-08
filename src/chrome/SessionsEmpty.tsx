import logo from "../assets/logo-8bit-gray.png";

/** Empty state for a project that has no sessions yet. */
export function SessionsEmpty({ message }: { message: string }) {
  return (
    // `min-h-full` rather than `h-full` so a short window scrolls instead of
    // clipping the artwork.
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-[13px] leading-relaxed text-content/45">{message}</p>
      <img src={logo} alt="" className="w-64" />
    </div>
  );
}
