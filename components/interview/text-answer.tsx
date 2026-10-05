'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function TextAnswer({
  disabled,
  busy,
  error,
  onSubmit,
  initialValue = '',
  heading = 'Your answer',
}: {
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (text: string, startedAt: Date) => void;
  initialValue?: string;
  heading?: string;
}) {
  const [answer, setAnswer] = useState(initialValue);
  const startedAt = useRef<Date | null>(null);

  function submit() {
    const text = answer.trim();
    if (!text || disabled) return;
    onSubmit(text, startedAt.current ?? new Date());
    startedAt.current = null;
  }

  return (
    <Card className="p-4">
      <label htmlFor="answer" className="mb-2 block text-sm font-medium">
        {heading}
      </label>
      <textarea
        id="answer"
        className="min-h-32 w-full resize-y rounded-lg border border-border bg-background p-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder="Type your answer here. Be specific: what you did, why, and what happened."
        value={answer}
        disabled={disabled}
        maxLength={8000}
        onChange={(e) => {
          if (startedAt.current === null) startedAt.current = new Date();
          setAnswer(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Press Ctrl or ⌘ + Enter to send</p>
        <Button onClick={submit} disabled={disabled || answer.trim().length === 0}>
          {busy ? 'Thinking…' : 'Send answer'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
