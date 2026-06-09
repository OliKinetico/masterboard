"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-7 w-7 shrink-0 overflow-hidden rounded-full",
      className,
    )}
    {...props}
  />
));
Avatar.displayName = "Avatar";

const AvatarFallback = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-brand-100 text-brand-800 text-[10px] font-semibold uppercase",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = "AvatarFallback";

/** Initials avatar for a user's full name. */
export function UserAvatar({
  name,
  className,
  title,
}: {
  name: string | null | undefined;
  className?: string;
  title?: string;
}) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return (
    <Avatar className={className} title={title ?? name ?? undefined}>
      <AvatarFallback>{initials || "?"}</AvatarFallback>
    </Avatar>
  );
}

export { Avatar, AvatarFallback };
