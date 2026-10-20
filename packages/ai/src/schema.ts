import { z } from 'zod';

// v4: photo quality / photo-to-asset matching removed from the prompt. Photos
// produced too many false rejections, so verification is text-only now
// (description + asset + sanitized location labels).
export const PROMPT_VERSION = 'v4' as const;
export const SCHEMA_VERSION = 'v2' as const;

// Models sometimes return `reasons` as objects (`{reason, reasoningSummary}`)
// instead of plain strings. Accept both and normalise to strings so a
// semantically valid verdict is never discarded over a cosmetic shape.
const reasonItemSchema = z.union([
  z.string().min(1),
  z.object({ reason: z.string().min(1) }).transform((value) => value.reason),
  z.object({ text: z.string().min(1) }).transform((value) => value.text),
]);

export const verifyVerdictSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  category: z.string().min(1).optional(),
  issueType: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasons: z.array(reasonItemSchema).optional(),
  reason: z.string().min(1).optional(),
  reasoningSummary: z.string().min(1).optional(),
});

export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

export function parseVerdict(raw: unknown): ReturnType<typeof verifyVerdictSchema.safeParse> {
  return verifyVerdictSchema.safeParse(raw);
}
