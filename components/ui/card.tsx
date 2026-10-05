import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-card shadow-sm', className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary';
}) {
  const tones = {
    default: 'bg-background text-muted border-border',
    primary: 'bg-accent text-primary border-transparent',
    success: 'bg-success/10 text-success border-transparent',
    warning: 'bg-warning/10 text-warning border-transparent',
    danger: 'bg-danger/10 text-danger border-transparent',
  };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
