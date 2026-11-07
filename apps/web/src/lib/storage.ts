import 'server-only';
import { createStorage, newStorageKey, sha256, detectFileType, MIME, UPLOAD_LIMITS, type DetectedType } from '@immo/core/storage';

/** Pilote de stockage choisi par STORAGE_DRIVER (local ou s3). */
export const storage = () => createStorage();
export { newStorageKey, sha256, detectFileType, MIME, UPLOAD_LIMITS };
export type { DetectedType };
