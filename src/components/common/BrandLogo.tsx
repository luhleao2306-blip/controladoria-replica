export function BrandLogo({ className = "", inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <span className={`relative inline-block aspect-[2048/470] shrink-0 ${className}`}>
      <img
        src="/brand/modblue-wordmark.webp"
        alt="Modblue"
        width={2048}
        height={470}
        className={`block h-full w-full object-contain ${inverse ? "brightness-0 invert" : "dark:brightness-0 dark:invert"}`}
      />
      {/* Keep the original symbol colors while making the dark wordmark readable on dark surfaces. */}
      <img
        src="/brand/modblue-wordmark.webp"
        alt=""
        aria-hidden="true"
        width={2048}
        height={470}
        className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${inverse ? "" : "opacity-0 dark:opacity-100"}`}
        style={{ clipPath: "polygon(0 0, 22% 0, 22% 60%, 31% 60%, 31% 100%, 0 100%)" }}
      />
    </span>
  );
}
