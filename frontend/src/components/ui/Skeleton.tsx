import React from 'react';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Base Skeleton Primitive Component — Khung xương tĩnh chạy hiệu ứng shimmer.
 * Độc lập 100%, không phụ thuộc file khác.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 6,
  style,
  className = '',
}) => {
  return (
    <div
      className={`skeleton-pulse ${className}`}
      style={{
        width,
        height,
        borderRadius,
        display: 'inline-block',
        ...style,
      }}
    />
  );
};

// ─── COMPOSITE PRESET SKELETONS ─────────────────────────────────────────────

/** PostSkeleton — Mô phỏng 100% layout của PostCard */
export const PostSkeleton: React.FC = () => {
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 16,
        padding: 24,
        border: '1px solid #E2E8F0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Skeleton width={44} height={44} borderRadius="50%" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <Skeleton width={140} height={14} />
          <Skeleton width={90} height={12} />
        </div>
      </div>

      {/* Title & Content */}
      <Skeleton width="75%" height={22} borderRadius={6} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width="100%" height={14} />
        <Skeleton width="92%" height={14} />
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Skeleton width={70} height={24} borderRadius={6} />
        <Skeleton width={85} height={24} borderRadius={6} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid #F1F5F9' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          <Skeleton width={50} height={16} />
          <Skeleton width={90} height={16} />
        </div>
        <Skeleton width={60} height={16} />
      </div>
    </div>
  );
};

/** CommentSkeleton — Mô phỏng layout của CommentItem */
export const CommentSkeleton: React.FC = () => {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Skeleton width={32} height={32} borderRadius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="60%" height={36} borderRadius={12} />
        <div style={{ display: 'flex', gap: 12 }}>
          <Skeleton width={50} height={10} />
          <Skeleton width={40} height={10} />
        </div>
      </div>
    </div>
  );
};

/** LikedPostSkeleton — Mô phỏng layout của bài viết đã thích trong right sidebar */
export const LikedPostSkeleton: React.FC = () => {
  return (
    <div style={{ alignSelf: 'stretch', gap: 12, display: 'flex', alignItems: 'center' }}>
      <Skeleton width={32} height={32} borderRadius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width={80} height={12} />
        <Skeleton width="90%" height={14} />
        <Skeleton width={100} height={10} />
      </div>
      <Skeleton width={48} height={48} borderRadius={6} />
    </div>
  );
};

/** CategorySkeleton — Mô phỏng layout của danh mục trong left sidebar */
export const CategorySkeleton: React.FC = () => {
  return (
    <div style={{ padding: '8px 16px' }}>
      <Skeleton width="80%" height={16} borderRadius={6} />
    </div>
  );
};

/** TrendingTopicSkeleton — Mô phỏng layout 1 dòng chủ đề nổi bật trong right sidebar */
export const TrendingTopicSkeleton: React.FC = () => {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Skeleton width={90} height={16} borderRadius={4} />
      <Skeleton width={55} height={14} borderRadius={4} />
    </div>
  );
};

/** StudyGroupCardSkeleton — Mô phỏng layout của thẻ nhóm học (`GroupCard` trong StudyGroups.tsx).
 * Giữ cùng khung, chiều cao và khoảng cách với thẻ thật để lưới không bị "nhảy" khi dữ liệu tải xong. */
export const StudyGroupCardSkeleton: React.FC = () => {
  return (
    // Độ rộng do hàng chứa quyết định (ROW_CLASSES trong StudyGroups.tsx): slider hiện 2 thẻ (màn nhỏ) → 3 → 4 → 5 thẻ (màn lớn).
    // Kích thước bên trong khớp GroupCard: bản gọn trên điện thoại (< 640px), bản thường từ 640px.
    // Chiều cao từng khối CỐ ĐỊNH, giống hệt GroupCard → mọi thẻ (thật lẫn skeleton) luôn cao bằng nhau.
    <div aria-hidden="true" className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Cover (h-24 → h-32) + streak badge góc phải */}
      <div className="relative h-24 shrink-0 sm:h-32">
        <div className="skeleton-pulse h-full w-full" />
        <div className="absolute right-2 top-2 h-6 w-11 rounded-full bg-white/80 sm:right-3 sm:top-3 sm:h-7 sm:w-14" />
      </div>

      {/* Card body (p-3 → p-5) */}
      <div className="flex flex-col p-3 sm:p-5">
        {/* Badge vai trò / công khai: h-5 → h-6 */}
        <div className="mb-2 skeleton-pulse h-5 w-16 rounded sm:mb-3 sm:h-6 sm:w-20" />
        {/* Tên nhóm: giữ chỗ 2 dòng, h-10 → h-12 */}
        <div className="mb-1 flex h-10 flex-col justify-center gap-1.5 sm:mb-2 sm:h-12">
          <div className="skeleton-pulse h-3.5 w-11/12 rounded-md sm:h-4" />
          <div className="skeleton-pulse h-3.5 w-1/2 rounded-md sm:h-4" />
        </div>
        {/* Mô tả: giữ chỗ 2 dòng, h-8 → h-10 */}
        <div className="mb-3 flex h-8 flex-col justify-center gap-1.5 sm:mb-5 sm:h-10 sm:gap-2">
          <div className="skeleton-pulse h-3 w-full rounded sm:h-3.5" />
          <div className="skeleton-pulse h-3 w-4/5 rounded sm:h-3.5" />
        </div>
        {/* Footer: số thành viên + nút hành động */}
        <div className="flex items-center justify-between border-t border-slate-300 pt-2.5 sm:pt-4">
          <div className="skeleton-pulse h-6 w-6 rounded-full sm:h-7 sm:w-7" />
          <div className="skeleton-pulse h-4 w-16 rounded sm:h-5 sm:w-24" />
        </div>
      </div>
    </div>
  );
};

/** ConversationItemSkeleton — Mô phỏng 1 dòng hội thoại trong danh sách DM */
export const ConversationItemSkeleton: React.FC = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
      <Skeleton width={40} height={40} borderRadius="50%" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="65%" height={14} />
        <Skeleton width="45%" height={12} />
      </div>
    </div>
  );
};

/** MessageBubbleSkeleton — Mô phỏng một tin nhắn bubble trong thread */
export const MessageBubbleSkeleton: React.FC<{ isSelf?: boolean }> = ({ isSelf = false }) => {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        flexDirection: isSelf ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
      }}
    >
      <Skeleton width={32} height={32} borderRadius="50%" style={{ flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: isSelf ? 'flex-end' : 'flex-start' }}>
        <Skeleton width={Math.floor(120 + Math.random() * 100)} height={40} borderRadius={14} />
        <Skeleton width={40} height={10} borderRadius={4} />
      </div>
    </div>
  );
};

/** PageLoadingSkeleton — Skeleton toàn trang khi ProtectedRoute đang xác thực */
export const PageLoadingSkeleton: React.FC = () => {
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#F8FAFC',
      }}
    >
      {/* Nav bar skeleton */}
      <div
        style={{
          height: 64,
          background: 'white',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 32px',
          gap: 24,
        }}
      >
        <Skeleton width={140} height={28} borderRadius={6} />
        <div style={{ flex: 1 }} />
        <Skeleton width={80} height={20} borderRadius={6} />
        <Skeleton width={80} height={20} borderRadius={6} />
        <Skeleton width={80} height={20} borderRadius={6} />
        <Skeleton width={36} height={36} borderRadius="50%" />
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          padding: '32px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <Skeleton width={260} height={32} borderRadius={8} />
        <Skeleton width="50%" height={18} borderRadius={6} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 8 }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                background: 'white',
                borderRadius: 8,
                border: '1px solid #E2E8F0',
                overflow: 'hidden',
              }}
            >
              <Skeleton width="100%" height={96} borderRadius={0} />
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="100%" height={12} />
                <Skeleton width="85%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** DmPageSkeleton — Skeleton toàn trang Direct Messages */
export const DmPageSkeleton: React.FC = () => {
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: 'white' }}>
      {/* Sidebar list */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#F8FAFC',
          borderRight: '1px solid #E2E8F0',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', background: 'white' }}>
          <Skeleton width={100} height={20} borderRadius={6} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 8 }}>
          {[...Array(6)].map((_, i) => (
            <ConversationItemSkeleton key={i} />
          ))}
        </div>
      </div>
      {/* Thread pane placeholder */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: '#CBD5E1',
        }}
      >
        <Skeleton width={48} height={48} borderRadius="50%" />
        <Skeleton width={240} height={16} borderRadius={6} />
      </div>
    </div>
  );
};
