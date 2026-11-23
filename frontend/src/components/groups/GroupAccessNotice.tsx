import type { ReactNode } from 'react';

export type GroupAccessReason = 'left' | 'banned' | 'visitor' | 'error';

interface Props {
  reason: GroupAccessReason;
  onBack: () => void;
  onRetry?: () => void;
}

const copy: Record<GroupAccessReason, { title: string; description: string }> = {
  left: {
    title: 'Bạn đã rời nhóm học này',
    description: 'Bạn không còn quyền sử dụng các chức năng của nhóm. Với nhóm công khai, bạn có thể tham gia lại từ danh sách nhóm học.',
  },
  banned: {
    title: 'Bạn không có quyền tham gia nhóm này',
    description: 'Tài khoản của bạn đã bị cấm khỏi nhóm. Bạn không thể tự tham gia lại.',
  },
  visitor: {
    title: 'Bạn chưa phải thành viên nhóm này',
    description: 'Hãy tham gia nhóm công khai hoặc dùng lời mời hợp lệ trước khi sử dụng các chức năng bên trong.',
  },
  error: {
    title: 'Không thể xác minh tư cách thành viên',
    description: 'Không thể tải thông tin thành viên. Hãy thử lại; chúng tôi chưa thể xác định bạn có quyền truy cập hay không.',
  },
};

export function GroupAccessNotice({ reason, onBack, onRetry }: Props): ReactNode {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-5 text-center">
      <h2 className="text-xl font-semibold text-slate-900">{copy[reason].title}</h2>
      <p className="max-w-lg text-sm text-slate-600">{copy[reason].description}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onBack} className="rounded-lg bg-[#00236F] px-4 py-2.5 text-sm font-semibold text-white">
          {reason === 'left' ? 'Tìm và tham gia lại' : 'Quay lại danh sách nhóm'}
        </button>
        {reason === 'error' && onRetry && (
          <button type="button" onClick={onRetry} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">
            Thử lại
          </button>
        )}
      </div>
    </div>
  );
}
