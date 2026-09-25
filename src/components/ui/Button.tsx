import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "default" | "small";
  block?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "default",
  block = false,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    `button--${variant}`,
    size === "small" ? "button--small" : "",
    block ? "button--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon alone is never a usable control name. */
  label: string;
  tone?: "default" | "danger";
  children: ReactNode;
}

export function IconButton({ label, tone = "default", children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${tone === "danger" ? " icon-button--danger" : ""}`}
      title={label}
      {...props}
    >
      {children}
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
