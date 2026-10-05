import { z } from 'zod';

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  ELEVENLABS_AGENT_ID: optionalString,
  AGENT_LLM_SECRET: optionalString,
  DEV_MODE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  VOICE_TRANSPORT: z
    .enum(['scribe', 'agent'])
    .optional()
    .transform((v) => v ?? 'scribe'),
  DATABASE_URL: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  DEMO_PASSWORD: optionalString,
  MAX_CONCURRENT_INTERVIEWS: int(4),
  MAX_SESSION_MINUTES: int(25),
  STORAGE_BUDGET_BYTES: int(800_000_000),
  MAX_VIDEO_BYTES: int(40_000_000),
  MAX_MONTHLY_UPLOADS: int(1500),
  USE_FAKES: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validates process.env once and returns typed config. Throws a readable error if anything is missing. */
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Test helper: forget the cached value. */
export function resetEnvCache() {
  cached = undefined;
}
