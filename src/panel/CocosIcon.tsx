import React from "react";
import type { CocosIconInfo } from "./cocosNodeIcon";

/** Renders a Cocos UI-kit SVG with Creator UiIcon `[color]` tinting. */
export function CocosIcon({
  icon,
  className,
}: {
  icon: CocosIconInfo;
  className?: string;
}) {
  if (!icon?.svg) return null;
  return (
    <span
      className={className}
      data-icon={icon.name}
      style={icon.color ? { color: icon.color } : undefined}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
