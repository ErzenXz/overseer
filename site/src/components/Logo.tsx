/**
 * The approved Overseer mark and wordmark.
 */
export function LogoMark({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/overseer-rounded.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}

export function Logo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="text-[15.5px] font-semibold tracking-[-0.02em]">
        Overseer
      </span>
    </span>
  );
}
