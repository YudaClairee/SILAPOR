import { z } from 'zod';

export const PROMPT_VERSION = 'v1' as const;
export const SCHEMA_VERSION = 'v1' as const;

export const verifyVerdictSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  category: z.string().min(1).optional(),
  issueType: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string()).optional(),
  reason: z.string().min(1).optional(),
});

export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

export function parseVerdict(raw: unknown): ReturnType<typeof verifyVerdictSchema.safeParse> {
  return verifyVerdictSchema.safeParse(raw);
}
