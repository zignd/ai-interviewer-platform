import { notFound, redirect } from 'next/navigation';
import { InterviewGate } from '@/components/interview/interview-gate';
import { ServiceError, getSessionView } from '@/lib/engine/service';
import { uuidSchema } from '@/lib/http';
import { getRepos } from '@/lib/repos';
import type { SessionViewData } from '@/lib/view-types';

export const dynamic = 'force-dynamic';

export default async function InterviewPage({
  params,
  searchParams,
}: PageProps<'/interview/[sessionId]'>) {
  const { sessionId } = await params;
  const query = await searchParams;
  const requested = Array.isArray(query.transport) ? query.transport[0] : query.transport;
  const transport =
    requested === 'agent' || requested === 'scribe'
      ? requested
      : process.env.VOICE_TRANSPORT === 'agent'
        ? 'agent'
        : 'scribe';
  if (!uuidSchema.safeParse(sessionId).success) notFound();
  let view;
  try {
    view = await getSessionView({ repos: getRepos() }, sessionId);
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
  if (view.session.status === 'completed') redirect(`/sessions/${sessionId}`);
  const initial = JSON.parse(JSON.stringify(view)) as SessionViewData;
  return (
    <InterviewGate initial={initial} transport={transport} devMode={process.env.DEV_MODE === '1'} />
  );
}
