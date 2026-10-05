import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { safeNext } from '@/lib/gate';

export const dynamic = 'force-dynamic';

export default async function GatePage({ searchParams }: PageProps<'/gate'>) {
  const query = await searchParams;
  const next = safeNext(Array.isArray(query.next) ? query.next[0] : query.next);
  const failed = Boolean(query.error);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Enter the demo password</h1>
        <p className="mt-2 text-sm text-muted">
          This demo is password protected to keep the speech and AI quotas under control.
        </p>
        <form action="/api/gate" method="post" className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            autoComplete="current-password"
            className="h-10 rounded-lg border border-border bg-background px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {failed && (
            <p role="alert" className="text-sm text-danger">
              That password isn&apos;t right. Try again.
            </p>
          )}
          <Button type="submit">Continue</Button>
        </form>
      </Card>
    </main>
  );
}
