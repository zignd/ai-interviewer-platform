import type { Analysis, BankQuestion, Category, PolicyDecision, Skill } from './types';

export type JobContext = {
  title: string;
  description: string;
  seniority: string;
  competencies: string[];
  keyterms: string[];
};

const JSON_ONLY =
  'Respond with a single JSON object and nothing else: no markdown, no code fences, no commentary.';

export function analyzePrompt(input: {
  job: JobContext;
  question: string;
  answer: string;
  topics: string[];
}) {
  const system = [
    `You analyse one candidate answer in a job interview for the role "${input.job.title}" (${input.job.seniority}).`,
    'Judge only what the candidate actually said. Do not invent evidence.',
    'Return JSON with these fields:',
    '- depth: "shallow" (vague, no concrete example, no result), "adequate" (some specifics), or "strong" (specific, own contribution, outcome, reflection).',
    '- quality: number from 0 to 10 for the overall quality of the answer.',
    '- skills: up to 4 objects {skill, evidence, confidence 0-1}. evidence is a phrase of at most 8 words copied from the answer.',
    '- missing: up to 3 strings of at most 8 words each, naming what a strong answer would have included but this one lacked.',
    '- hook: one specific claim (at most 15 words) copied from the answer that is worth probing further, or null.',
    JSON_ONLY,
  ].join('\n');
  const user = [
    `Role competencies: ${input.job.competencies.join('; ')}`,
    `Interview topics: ${input.topics.join(', ')}`,
    `Question asked: ${input.question}`,
    `Candidate answer: """${input.answer}"""`,
  ].join('\n');
  return { system, user };
}

export function generatePrompt(input: {
  job: JobContext;
  decision: Pick<PolicyDecision, 'action' | 'targetTopic'>;
  bankQuestion: BankQuestion | null;
  previousQuestion: string | null;
  answer: string | null;
  hook: string | null;
  hints: string[];
  transcriptTail: { role: 'interviewer' | 'candidate'; text: string }[];
}) {
  const isFollowUp = input.decision.action === 'FOLLOW_UP';
  const system = [
    `You are a friendly, professional interviewer hiring for "${input.job.title}" (${input.job.seniority}). You are speaking aloud, so write the way a person talks: one question, at most two short sentences, no lists, no preamble like "Great answer".`,
    isFollowUp
      ? [
          "Write ONE follow-up question that builds on a specific detail of the candidate's last answer.",
          'Put 3 to 12 words copied EXACTLY from the candidate\'s answer in "anchor", and make the question refer to them.',
          'Do not repeat the original question. Ask for depth: what they personally did, how they decided, what happened, or what they would change.',
        ].join('\n')
      : [
          'Ask the bank question below. You may lightly rephrase it so it flows from the conversation, but keep its meaning and topic exactly. Do not add a second question. Set "anchor" to null.',
        ].join('\n'),
    'Return JSON: {"question": string, "rationale": string (one sentence on why this question, for the decision panel), "anchor": string or null}.',
    JSON_ONLY,
  ].join('\n');

  const parts = [`Role: ${input.job.title}. ${input.job.description}`];
  if (isFollowUp) {
    parts.push(`Previous question: ${input.previousQuestion ?? ''}`);
    parts.push(`Candidate's answer: """${input.answer ?? ''}"""`);
    if (input.hook) parts.push(`Worth probing: ${input.hook}`);
    if (input.hints.length) parts.push(`Optional angles: ${input.hints.join(' | ')}`);
  } else if (input.bankQuestion) {
    parts.push(`Topic: ${input.bankQuestion.topic} (${input.bankQuestion.category})`);
    parts.push(`Bank question: ${input.bankQuestion.text}`);
    if (input.previousQuestion) parts.push(`Previous question was: ${input.previousQuestion}`);
  }
  if (input.transcriptTail.length) {
    parts.push(
      'Recent conversation:\n' +
        input.transcriptTail
          .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
          .join('\n'),
    );
  }
  return { system, user: parts.join('\n') };
}

export function samplePrompt(input: {
  job: JobContext;
  question: string;
  isFollowUp: boolean;
  earlier: { role: 'interviewer' | 'candidate'; text: string }[];
}) {
  const system = [
    'You help a developer test an interview app. Write the answer that a strong, experienced candidate would say OUT LOUD to the question.',
    `The role is "${input.job.title}" (${input.job.seniority}).`,
    'Style: first person, natural spoken English, no lists or headings, 90 to 140 words.',
    'Content: one concrete real-sounding example, what the candidate personally did and why, a measurable result, and what they learned or would change.',
    input.isFollowUp
      ? 'The question is a follow-up: answer it directly and stay consistent with the earlier answers shown.'
      : 'Do not mention that this is a test.',
    'Return JSON: {"answer": string}.',
    JSON_ONLY,
  ].join('\n');
  const user = [
    ...input.earlier.map(
      (t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`,
    ),
    `Question to answer now: ${input.question}`,
  ].join('\n');
  return { system, user };
}

export function evaluatePrompt(input: {
  job: JobContext;
  transcript: { role: 'interviewer' | 'candidate'; text: string; kind: string | null }[];
  skills: Skill[];
  qualityHistory: number[];
  gaps: string[];
}) {
  const system = [
    `You are a hiring evaluator. Score a candidate interviewed for "${input.job.title}" (${input.job.seniority}) using only the transcript.`,
    'Be fair and specific. Cite evidence from the answers. Do not reward length for its own sake; penalise vague answers with no example or outcome.',
    'Return JSON with:',
    '- overall_score: integer 0-100.',
    '- recommendation: "strong_hire" (85+), "hire" (70-84), "lean_hire" (55-69), or "no_hire" (below 55).',
    '- summary: 2 to 3 sentences.',
    '- strengths: 1 to 5 short strings, each grounded in the transcript.',
    '- concerns: 0 to 5 short strings, each grounded in the transcript.',
    '- competencies: one object per role competency, {competency, score 1-5, evidence (a short phrase from the transcript, or "not demonstrated")}.',
    JSON_ONLY,
  ].join('\n');
  const user = [
    `Role competencies: ${input.job.competencies.join('; ')}`,
    `Skills detected during the interview: ${input.skills.map((s) => s.skill).join(', ') || 'none'}`,
    `Gaps noted: ${input.gaps.join('; ') || 'none'}`,
    'Transcript:',
    ...input.transcript.map(
      (t) =>
        `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}${t.kind === 'follow_up' ? ' (follow-up)' : ''}: ${t.text}`,
    ),
  ].join('\n');
  return { system, user };
}

export type { Analysis, Category };
