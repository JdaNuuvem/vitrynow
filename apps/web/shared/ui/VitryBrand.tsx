import "./vitry-brand.css";

export function VitryBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="vitry-brand">
      {/* A single local SVG is shared by the wordmark and favicon. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vitry-mark.svg" width={36} height={36} alt={compact ? "VitryNow" : ""} />
      {!compact && <span>Vitry<span className="vitry-brand__suffix">Now</span></span>}
    </span>
  );
}
