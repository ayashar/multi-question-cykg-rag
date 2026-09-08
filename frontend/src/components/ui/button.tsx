import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[3px] transition-colors disabled:pointer-events-none cursor-pointer font-google-sans",
  {
    variants: {
      variant: {
        purple: "bg-purple-600 hover:bg-purple-700 text-neutral-100",
        disabled: "bg-black-200 cursor-not-allowed text-black",
      },
      size: {
        default: "py-2 px-3.5 font-b3",
        icon: "p-2 font-b3",
      },
    },
    defaultVariants: {
      variant: "purple",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    isActive?: boolean;
  };

function Button({
  className,
  variant,
  size,
  isActive,
  ...props
}: ButtonProps) {
  return (
    <button
      data-active={isActive ? "true" : undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };