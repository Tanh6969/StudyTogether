/**
 * DB giả của mock mode: một object JSON lưu trong localStorage, nên dữ liệu bạn tạo/sửa
 * vẫn còn sau khi reload trang. Gọi `resetMockDb()` (hoặc `window.__resetMockDb()` trong
 * console) để quay về dữ liệu mẫu ban đầu.
 */
import { createSeed, MOCK_DB_VERSION, type MockDb } from './seed';

const STORAGE_KEY = 'studytogether_mock_db';

let cache: MockDb | null = null;

function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed.version === MOCK_DB_VERSION) {
        // Add the latest task-board demo cards to existing mock sessions without
        // resetting the user's mock account or other saved data.
        const latestSeedTasks = createSeed().tasks.filter(task => ['task-11', 'task-12', 'task-13'].includes(task.id));
        const existingTaskIds = new Set(parsed.tasks.map(task => task.id));
        parsed.tasks.push(...latestSeedTasks.filter(task => !existingTaskIds.has(task.id)));
        return parsed;
      }
    }
  } catch {
    // localStorage bị chặn hoặc dữ liệu hỏng -> dùng seed mới
  }
  return createSeed();
}

export function getDb(): MockDb {
  if (!cache) cache = load();
  return cache;
}

export function saveDb(): void {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Không lưu được thì vẫn chạy với dữ liệu trong bộ nhớ
  }
}

export function resetMockDb(): void {
  cache = createSeed();
  saveDb();
}

let idSeq = 0;
export function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}${idSeq.toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

if (typeof window !== 'undefined') {
  (window as unknown as { __resetMockDb: () => void }).__resetMockDb = () => {
    resetMockDb();
    window.location.reload();
  };
}
