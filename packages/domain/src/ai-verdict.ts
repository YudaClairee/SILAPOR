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
  // Runtime-guard choice (documented): a non-string/blank impliedCategory
  // means the AI implied nothing usable → UNCLEAR_EVIDENCE; a non-string
  // assetCategory/category/issueType means the caller passed a code that can
  // never match the master list → UNKNOWN_CODE (same as an unknown string
  // code). All string fields are trimmed ONCE into locals and only the
  // trimmed values are used for every includes/equality check and return,
  // so ' HVAC ' behaves exactly like 'HVAC'.
  const raw = (input ?? {}) as unknown as Partial<Record<string, unknown>>;
  const implied =
    typeof raw['impliedCategory'] === 'string' ? (raw['impliedCategory'] as string).trim() : '';
  if (implied === '') {
    return { ok: false, reason: 'UNCLEAR_EVIDENCE' };
  }
  if (
    typeof raw['assetCategory'] !== 'string' ||
    typeof raw['category'] !== 'string' ||
    typeof raw['issueType'] !== 'string'
  ) {
    return { ok: false, reason: 'UNKNOWN_CODE' };
  }
  const assetCategory = (raw['assetCategory'] as string).trim();
  const category = (raw['category'] as string).trim();
  const issueType = (raw['issueType'] as string).trim();
  const priority =
    typeof raw['priority'] === 'string' ? (raw['priority'] as string).trim() : input.priority;
  if (
    !input.categories.includes(implied) ||
    !input.categories.includes(assetCategory) ||
    !input.categories.includes(category) ||
    !input.issueTypes.includes(issueType)
  ) {
    return { ok: false, reason: 'UNKNOWN_CODE' };
  }
  if (implied !== assetCategory) {
    return { ok: false, reason: 'WRONG_ASSET' };
  }
  return {
    ok: true,
    categoryCode: category,
    issueTypeCode: issueType,
    priority,
  };
}
