import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-8 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-[13px] font-[550] transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-app)] active:scale-[0.98] disabled:pointer-events-none disabled:text-[var(--text-disabled)] disabled:opacity-100",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
        destructive: "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/90",
        outline: "border border-[var(--color-border)] bg-transparent hover:bg-[var(--color-bg-hover)]",
        secondary: "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-active)]",
        ghost: "hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]",
        link: "text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
