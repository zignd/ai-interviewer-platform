export function ProgressHeader({
  title,
  asked,
  target,
}: {
  title: string;
  asked: number;
  target: number;
}) {
  const pct = Math.min(100, Math.round((asked / target) * 100));
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-muted">Interview</p>
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>
      <div className="text-right text-sm text-muted" aria-live="polite">
        {asked > 0 ? `Question ${asked} of about ${Math.max(target, asked)}` : 'Getting ready…'}
        <div
          className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-label="Interview progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
