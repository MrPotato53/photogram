import clsx from 'clsx';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s/g, '-');

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-theme-text-secondary"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          'w-full px-2.5 py-1.5 text-sm rounded-md',
          'bg-theme-bg-tertiary border text-theme-text',
          'placeholder:text-theme-text-muted',
          'hover:border-theme-border-hover',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          'transition-colors',
          error ? 'border-red-500' : 'border-theme-border',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
