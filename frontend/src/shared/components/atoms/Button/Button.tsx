import React from "react";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "ghost" | "navCta" | "submit";

interface ButtonProps {
  variant?: ButtonVariant;
  href?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

export const Button = ({
  variant = "primary",
  href,
  type = "button",
  disabled = false,
  onClick,
  icon,
  iconPosition = "right",
  className = "",
  children,
  "aria-label": ariaLabel,
}: ButtonProps) => {
  const classNames = [styles.btn, styles[variant], className].filter(Boolean).join(" ");

  const iconEl = icon ? <span className={styles.iconWrapper}>{icon}</span> : null;

  const content = (
    <>
      {icon && iconPosition === "left" && iconEl}
      {children}
      {icon && iconPosition === "right" && iconEl}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={classNames}
        onClick={onClick as React.MouseEventHandler<HTMLAnchorElement>}
        aria-label={ariaLabel}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled}
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
};
