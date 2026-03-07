import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import Link from 'next/link';

import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'primary-positive' | 'primary-negative';

type ButtonSize = 'md' | 'sm' | 'xs';

interface ButtonProps {
  children: ReactNode;
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  style?: CSSProperties;
  onClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  target?: '_blank' | '_self' | '_parent' | '_top';
  rel?: string;
  external?: boolean;
  title?: string;
  square?: boolean;
}

const combineClassNames = (...classNames: Array<string | undefined>) => {
  return classNames.filter(Boolean).join(' ');
};

export default function Button({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className,
  style,
  onClick,
  disabled,
  type = 'button',
  target,
  rel,
  external,
  title,
  square = false
}: ButtonProps) {
  const variantClass = (() => {
    switch (variant) {
      case 'secondary':
        return styles.buttonSecondary;
      case 'primary-positive':
        return styles.buttonPositive;
      case 'primary-negative':
        return styles.buttonNegative;
      default:
        return styles.buttonPrimary;
    }
  })();

  const sizeClass = size === 'xs' ? styles.buttonXs : size === 'sm' ? styles.buttonSmall : undefined;
  const buttonClassName = combineClassNames(
    styles.button,
    variantClass,
    sizeClass,
    square ? styles.buttonSquare : undefined,
    className
  );

  if (href) {
    const isExternal = external || href.startsWith('http') || target === '_blank';
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }

      onClick?.(event);
    };

    if (isExternal) {
      return (
        <a
          href={href}
          className={buttonClassName}
          style={style}
          aria-disabled={disabled ? 'true' : undefined}
          onClick={handleClick}
          tabIndex={disabled ? -1 : undefined}
          target={target}
          rel={rel}
          title={title}
        >
          {children}
        </a>
      );
    }

    return (
      <Link
        href={href}
        className={buttonClassName}
        style={style}
        aria-disabled={disabled ? 'true' : undefined}
        onClick={handleClick}
        tabIndex={disabled ? -1 : undefined}
        title={title}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={buttonClassName}
      style={style}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
