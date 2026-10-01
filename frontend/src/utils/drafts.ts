/**
 * PKG-03: Post Drafts — autosave nội dung đang soạn vào localStorage.
 * Logic thuần (test được dưới Node); storage được inject khi cần.
 */

export const DRAFTS_STORAGE_KEY = 'pulse_drafts';
export const AUTOSAVE_DEBOUNCE_MS = 1000;

export interface PostDraft {
  id: string;
  content: string;
  mediaUrls?: string[];
  pollChoices?: string[];
  contentWarning?: string;
  isSensitive?: boolean;
  replyToId?: string | null;
  savedAt: string;
}

function readAll(storage?: Pick<Storage, 'getItem'>): Record<string, PostDraft> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(drafts: Record<string, PostDraft>, storage?: Pick<Storage, 'setItem'>): void {
  if (!storage) return;
  try {
    storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // quota exceeded hoặc storage bị chặn — bỏ qua im lặng
  }
}

/** Slot mặc định cho composer chính; reply dùng `reply:<postId>`. */
export function slotKeyForComposer(purpose: 'post' | 'reply' | 'quote', targetId?: string): string {
  if (purpose === 'post') return 'post';
  return `${purpose}:${targetId || 'unknown'}`;
}

export function saveDraft(
  slot: string,
  draft: Omit<PostDraft, 'id' | 'savedAt'>,
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): PostDraft {
  const all = readAll(storage);
  const saved: PostDraft = {
    ...draft,
    id: slot,
    savedAt: new Date().toISOString(),
  };
  all[slot] = saved;
  writeAll(all, storage);
  return saved;
}

export function loadDraft(slot: string, storage?: Pick<Storage, 'getItem'>): PostDraft | null {
  return readAll(storage)[slot] || null;
}

export function clearDraft(slot: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const all = readAll(storage);
  if (slot in all) {
    delete all[slot];
    writeAll(all, storage);
  }
}

export function listDrafts(storage?: Pick<Storage, 'getItem'>): PostDraft[] {
  return Object.values(readAll(storage)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Draft có nội dung đáng lưu không (tránh lưu chuỗi rỗng/khoảng trắng). */
export function isDraftMeaningful(draft: Pick<PostDraft, 'content' | 'mediaUrls'>): boolean {
  if (draft.content && draft.content.trim().length > 0) return true;
  return Boolean(draft.mediaUrls && draft.mediaUrls.length > 0);
}

/** Debounce đơn giản cho autosave ~1s. */
export function createAutosaver(
  slot: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  delayMs: number = AUTOSAVE_DEBOUNCE_MS
): { save: (draft: Omit<PostDraft, 'id' | 'savedAt'>) => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Omit<PostDraft, 'id' | 'savedAt'> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      saveDraft(slot, pending, storage);
      pending = null;
    }
  };

  return {
    save(draft) {
      pending = draft;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, delayMs);
    },
    flush,
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
