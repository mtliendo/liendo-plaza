"use client";

import type { MouseEvent, ReactNode } from "react";

export function SoftLink({
  href,
  current,
  onGo,
  onPrefetch,
  children,
  className,
}: {
  href: string;
  current?: boolean;
  onGo: () => void;
  onPrefetch?: () => void;
  children: ReactNode;
  className?: string;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onGo();
  }
  return (
    <a
      href={href}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onTouchStart={onPrefetch}
    >
      {children}
    </a>
  );
}
