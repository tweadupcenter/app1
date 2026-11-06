import 'server-only';
import { localStorage as local, newStorageKey, sha256, detectFileType, MIME, UPLOAD_LIMITS, type DetectedType } from '@immo/core/storage';

let _s: ReturnType<typeof local> | null = null;
export const storage = () => (_s ??= local(process.env.STORAGE_DIR));
export { newStorageKey, sha256, detectFileType, MIME, UPLOAD_LIMITS };
export type { DetectedType };
