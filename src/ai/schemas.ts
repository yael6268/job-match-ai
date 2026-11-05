// Zod schemas for Gemini output + the matching Gemini `responseSchema` objects (SPEC.md section 8).
import { z } from 'zod';

export const matchOutputSchema = z.object({
  score: z.number().min(0).max(100).transform((n) => Math.round(n)),
  bestCvId: z.string().min(1),
  requiredYears: z.number().int().min(0).max(30).nullable().optional(),
  reasons: z.array(z.string().trim().min(1)).min(1).max(6),
  tips: z.array(z.string().trim().min(1)).min(1).max(8),
});

export type MatchOutput = z.infer<typeof matchOutputSchema>;

/** Validate a parsed match object. Throws an Error describing the first problem. */
export function parseMatchOutput(raw: unknown, cvIds: string[]): MatchOutput {
  const r = matchOutputSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`invalid match output: ${issue?.path.join('.') || 'root'} ${issue?.message ?? ''}`.trim());
  }
  if (!cvIds.includes(r.data.bestCvId)) throw new Error(`invalid match output: unknown bestCvId "${r.data.bestCvId}"`);
  return r.data;
}

/** Gemini structured-output schema (OpenAPI subset) for the match call. */
export function matchResponseSchema(cvIds: string[]) {
  return {
    type: 'OBJECT',
    properties: {
      score: { type: 'INTEGER', description: 'Fit of the best CV to the job, 0-100' },
      bestCvId: { type: 'STRING', enum: cvIds },
      requiredYears: { type: 'INTEGER', nullable: true, description: 'Minimum years of experience the job requires' },
      reasons: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-4 short Hebrew sentences' },
      tips: { type: 'ARRAY', items: { type: 'STRING' }, description: '3-5 concrete Hebrew tips for this job' },
    },
    required: ['score', 'bestCvId', 'reasons', 'tips'],
    propertyOrdering: ['score', 'bestCvId', 'requiredYears', 'reasons', 'tips'],
  } as const;
}

/** Pull the JSON text out of a generateContent response and parse it. Throws on blocked/empty/broken output. */
export function extractJson(response: unknown): unknown {
  const r = response as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  if (r?.promptFeedback?.blockReason) throw new Error(`blocked: ${r.promptFeedback.blockReason}`);
  const cand = r?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error(`empty response${cand?.finishReason ? ` (${cand.finishReason})` : ''}`);
  // Structured output is plain JSON, but tolerate a stray ```json fence.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error('response is not valid JSON');
  }
}

// ---------- referral email ----------

export const referralOutputSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(20).max(3000),
});

export type ReferralOutput = z.infer<typeof referralOutputSchema>;

export function parseReferralOutput(raw: unknown): ReferralOutput {
  const r = referralOutputSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(`invalid referral output: ${issue?.path.join('.') || 'root'} ${issue?.message ?? ''}`.trim());
  }
  return r.data;
}

export const referralResponseSchema = {
  type: 'OBJECT',
  properties: {
    subject: { type: 'STRING' },
    body: { type: 'STRING', description: 'Hebrew email body, 80-120 words' },
  },
  required: ['subject', 'body'],
  propertyOrdering: ['subject', 'body'],
} as const;
