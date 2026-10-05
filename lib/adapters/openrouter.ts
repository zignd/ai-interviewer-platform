import type { ZodType } from 'zod';
import type { LlmClient, LlmRequest } from '@/lib/ports';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Pulls the first JSON object out of a model response, tolerating code fences and chatter. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(body.slice(start, end + 1));
}

export type OpenRouterOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  referer?: string;
  title?: string;
};

export class OpenRouterClient implements LlmClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: OpenRouterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async call(
    request: LlmRequest<unknown>,
    extraUser?: string,
    withReasoning = true,
  ): Promise<string> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.options.referer ?? 'https://ai-interviewer.vercel.app',
        'X-Title': this.options.title ?? 'AI Interviewer',
      },
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? 1000,
        // Reasoning tokens count against max_tokens, so cap them or the JSON can come back empty.
        ...(withReasoning && request.reasoningEffort
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.prompt.system },
          {
            role: 'user',
            content: extraUser ? `${request.prompt.user}\n\n${extraUser}` : request.prompt.user,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Some models reject the reasoning option; retry once without it.
      if (
        withReasoning &&
        request.reasoningEffort &&
        res.status === 400 &&
        /reasoning/i.test(body)
      ) {
        return this.call(request, extraUser, false);
      }
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter returned no content');
    return content;
  }

  async complete<T>(request: LlmRequest<T>): Promise<T> {
    const parse = (text: string, schema: ZodType<T>) => schema.safeParse(extractJson(text));
    const first = await this.call(request);
    try {
      const parsed = parse(first, request.schema);
      if (parsed.success) return parsed.data;
      // One repair attempt that tells the model what was wrong.
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const second = await this.call(
        request,
        `Your previous reply was invalid (${issues}). Reply again with only the corrected JSON object.`,
      );
      return request.schema.parse(extractJson(second));
    } catch (err) {
      if (
        err instanceof SyntaxError ||
        (err instanceof Error && err.message.startsWith('No JSON'))
      ) {
        const second = await this.call(
          request,
          'Your previous reply was not valid JSON. Reply with only the JSON object.',
        );
        return request.schema.parse(extractJson(second));
      }
      throw err;
    }
  }
}
