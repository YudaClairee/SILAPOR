// Task 2: pure AI-verdict mapping with wrong-asset guard (pure — no I/O, no imports).
// The caller passes master-list codes in; this module validates the AI verdict
// against those lists and never silently recodes across categories.

export interface AiVerdictInput {
  impliedCategory: string;
  assetCategory: string;
  category: string;
  issueType: string;
  priority: string;
  categories: readonly string[];
  issueTypes: readonly string[];
}

export type AiVerdictResult =
  | { ok: true; categoryCode: string; issueTypeCode: string; priority: string }
  | { ok: false; reason: 'WRONG_ASSET' | 'UNCLEAR_EVIDENCE' | 'UNKNOWN_CODE' };

export function mapAiVerdict(input: AiVerdictInput): AiVerdictResult {
  if (input.impliedCategory.trim() === '') {
    return { ok: false, reason: 'UNCLEAR_EVIDENCE' };
  }
  if (
    !input.categories.includes(input.impliedCategory) ||
    !input.categories.includes(input.assetCategory) ||
    !input.categories.includes(input.category) ||
    !input.issueTypes.includes(input.issueType)
  ) {
    return { ok: false, reason: 'UNKNOWN_CODE' };
  }
  if (input.impliedCategory !== input.assetCategory) {
    return { ok: false, reason: 'WRONG_ASSET' };
  }
  return {
    ok: true,
    categoryCode: input.category,
    issueTypeCode: input.issueType,
    priority: input.priority,
  };
}
