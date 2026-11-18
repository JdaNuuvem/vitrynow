import type { CSSProperties } from "react";
import "./ui.css";

export function Shine({ width = "100%", height = 24, radius = 8 }: { width?: number | string; height?: number | string; radius?: number }) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <div className="ui-shine" style={style} aria-hidden="true" />;
}
