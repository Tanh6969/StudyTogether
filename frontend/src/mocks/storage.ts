/**
 * Kho file giả cho mock mode: giữ File đã "upload" trong bộ nhớ (theo path) và trả về
 * object URL để xem/tải. Chỉ tồn tại trong phiên hiện tại -- reload trang sẽ mất nội dung
 * file (metadata trong DB vẫn còn, khi đó trả về một file placeholder).
 */
const files = new Map<string, string>();

export const MOCK_UPLOAD_PREFIX = 'mock-upload://';

export function mockUploadUrl(path: string): string {
  return `${MOCK_UPLOAD_PREFIX}${path}`;
}

export function isMockUploadUrl(url: string): boolean {
  return url.startsWith(MOCK_UPLOAD_PREFIX);
}

export function putMockFile(pathOrUploadUrl: string, file: Blob): void {
  const path = pathOrUploadUrl.startsWith(MOCK_UPLOAD_PREFIX)
    ? pathOrUploadUrl.slice(MOCK_UPLOAD_PREFIX.length)
    : pathOrUploadUrl;
  const previous = files.get(path);
  if (previous) URL.revokeObjectURL(previous);
  files.set(path, URL.createObjectURL(file));
}

export function getMockFileUrl(path: string, fallbackName = 'file'): string {
  const url = files.get(path);
  if (url) return url;
  const text = `Đây là file mẫu "${fallbackName}" (dữ liệu mock, chưa có nội dung thật).`;
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}
