// Shared photo upload validation, image processing, and fail-open AI content
// moderation pipeline used by both `/api/uploads` (pre-submit staging) and
// `/api/reports/:id/attachments` (post-submit attachments).
import {
  moderatePhoto as aiModeratePhoto,
  type ModeratePhotoInput,
  type ModeratePhotoOpts,
  type ModeratePhotoOutcome,
  type ModeratePhotoRejectCategory,
} from '@silapor/ai';
import { AppError, getRuntimeConfig, payloadTooLarge } from '@silapor/shared';
import {
  AttachmentValidationError,
  MAX_ATTACHMENT_BYTES,
  prepareVisionImage,
  processImage,
  sanitizeOriginalFilename,
  validateAttachment,
  type ProcessedImage,
} from '@silapor/storage';

export interface PhotoUploadFile {
  readonly bytes: Uint8Array;
  readonly declaredMime: string;
  readonly originalFilename: string;
}

export interface ProcessedPhotoUpload {
  readonly image: ProcessedImage;
  readonly originalFilename: string;
}

export type PhotoModerator = (
  input: ModeratePhotoInput,
  opts: ModeratePhotoOpts,
) => Promise<ModeratePhotoOutcome>;

const MODERATION_VISION_MAX_EDGE = 768;
const MODERATION_VISION_QUALITY = 75;

const REJECTION_REASONS: Record<ModeratePhotoRejectCategory, string> = {
  NSFW_OR_VIOLENCE: 'terindikasi mengandung konten tidak pantas atau kekerasan.',
  SELFIE_OR_PORTRAIT: 'tampak seperti foto selfie atau potret wajah, bukan kondisi fasilitas.',
  MEME_OR_SCREENSHOT:
    'tampak seperti meme atau tangkapan layar aplikasi/chat, bukan foto fasilitas kampus.',
  OFF_TOPIC_PERSONAL:
    'tidak berkaitan dengan fasilitas atau ruangan (misalnya foto makanan atau barang pribadi).',
};

function formatPhotoModerationMessage(
  category: ModeratePhotoRejectCategory,
  totalCount: number,
  index: number,
): string {
  const prefix = totalCount > 1 ? `Foto ke-${index + 1} ditolak` : 'Foto ditolak';
  return `${prefix} karena ${REJECTION_REASONS[category]}`;
}

function mapAttachmentValidationError(error: unknown): never {
  if (error instanceof AttachmentValidationError) {
    if (error.code === 'FILE_TOO_LARGE') {
      throw payloadTooLarge('Attachment exceeds the maximum allowed size.');
    }
    throw new AppError({ code: error.code, status: 400, message: error.message });
  }
  throw error;
}

/**
 * Validates size, magic bytes, MIME match, re-encodes every file, and runs
 * parallel fail-open AI content moderation before any storage write happens.
 */
export async function validateAndProcessPhotos(
  formFiles: readonly PhotoUploadFile[],
  moderateOverride?: PhotoModerator,
): Promise<ProcessedPhotoUpload[]> {
  const processed: ProcessedPhotoUpload[] = [];
  for (const file of formFiles) {
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw payloadTooLarge('Attachment exceeds the maximum allowed size.');
    }
    try {
      validateAttachment({
        bytes: file.bytes,
        declaredMime: file.declaredMime,
        originalFilename: file.originalFilename,
      });
    } catch (error) {
      mapAttachmentValidationError(error);
    }
    let image: ProcessedImage;
    try {
      image = await processImage(file.bytes);
    } catch (error) {
      mapAttachmentValidationError(error);
    }
    processed.push({ image, originalFilename: sanitizeOriginalFilename(file.originalFilename) });
  }

  const config = getRuntimeConfig();
  const apiKey = config.openrouterApiKey.trim();
  const model = config.openrouterModel.trim();
  const timeoutMs = config.aiVerifyTimeoutMs;

  if (moderateOverride === undefined && (apiKey === '' || model === '')) {
    return processed;
  }

  const moderator = moderateOverride ?? aiModeratePhoto;
  const modOpts: ModeratePhotoOpts = {
    timeoutMs,
    apiKey: apiKey !== '' ? apiKey : 'test-key',
    model: model !== '' ? model : 'google/gemini-2.5-flash',
  };

  const outcomes = await Promise.all(
    processed.map(async (item) => {
      try {
        const vision = await prepareVisionImage(item.image.bytes, {
          maxEdge: MODERATION_VISION_MAX_EDGE,
          quality: MODERATION_VISION_QUALITY,
        });
        return await moderator({ bytes: vision.bytes, mimeType: vision.mimeType }, modOpts);
      } catch {
        return { kind: 'SKIPPED' } as const;
      }
    }),
  );

  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome?.kind === 'REJECT') {
      throw new AppError({
        code: 'PHOTO_REJECTED',
        status: 422,
        message: formatPhotoModerationMessage(outcome.category, outcomes.length, index),
      });
    }
  }

  return processed;
}
