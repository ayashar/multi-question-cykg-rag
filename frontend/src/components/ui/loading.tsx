"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl";
  label?: string;
}

const sizeClasses = {
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-2",
  lg: "w-9 h-9 border-3",
  xl: "w-12 h-12 border-4",
};

export function Spinner({
  size = "md",
  label,
  className,
  ...props
}: SpinnerProps) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)} {...props}>
      <div
        className={cn(
          "rounded-full border-neutral-300 border-t-primary-600 animate-spin shrink-0",
          sizeClasses[size]
        )}
      />
      {label ? (
        <span className="font-b3 text-neutral-800 select-none">{label}</span>
      ) : null}
    </div>
  );
}

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  variant = "text",
  width,
  height,
  className,
  style,
  ...props
}: SkeletonProps) {
  const variantStyles = {
    text: "rounded-[3px] h-4 w-full",
    circular: "rounded-full aspect-square",
    rectangular: "rounded-md w-full",
  };

  return (
    <div
      className={cn(
        "animate-pulse bg-neutral-200 dark:bg-neutral-800",
        variantStyles[variant],
        className
      )}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        ...style,
      }}
      {...props}
    />
  );
}

export interface LoadingOverlayProps
  extends React.HTMLAttributes<HTMLDivElement> {
  message?: string;
  fullScreen?: boolean;
}

export function LoadingOverlay({
  message = "Loading...",
  fullScreen = false,
  className,
  ...props
}: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-xs z-50",
        fullScreen
          ? "fixed inset-0"
          : "absolute inset-0 rounded-inherit min-h-32",
        className
      )}
      {...props}
    >
      <Spinner size="lg" />
      {message ? (
        <p className="font-b2 text-neutral-800 font-medium">{message}</p>
      ) : null}
    </div>
  );
}
