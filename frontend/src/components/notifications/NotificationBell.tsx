import React, { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '../../contexts/notification-context';
import { CountBadge } from '../ui/CountBadge';
import { NotificationDropdownModal } from './NotificationDropdownModal';

interface NotificationBellProps {
  /** Where the panel opens: under the bell (top header) or upward (phone bottom bar). */
  placement?: 'below' | 'above';
  /** 'icon' (default): round icon button for the top header.
   *  'tab': icon + "Thông báo" label, filling one slot of the phone bottom bar. */
  variant?: 'icon' | 'tab';
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ placement = 'below', variant = 'icon' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const { unreadCounts } = useNotifications();

  if (variant === 'tab') {
    return (
      <div className="relative flex min-w-0 flex-1">
        <button
          ref={bellRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Thông báo"
          aria-expanded={isOpen}
          className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-xl border-none py-1.5 text-[10px] font-semibold transition-colors ${
            isOpen ? 'bg-[#00236F]/10 text-[#00236F]' : 'bg-transparent text-slate-500 active:bg-slate-100'
          }`}
        >
          <span className="relative flex">
            <Bell size={21} strokeWidth={2.2} />
            <CountBadge count={unreadCounts.total} style={{ top: -4, right: -8 }} />
          </span>
          <span aria-hidden="true">Thông báo</span>
        </button>

        <NotificationDropdownModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          triggerRef={bellRef}
          placement={placement}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={bellRef}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Thông báo"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isOpen ? '#1877F2' : '#00236F',
          padding: 6,
          borderRadius: '50%',
          position: 'relative',
          transition: 'color 0.2s, background-color 0.2s',
        }}
        className="hover:bg-slate-100 transition-colors"
      >
        <Bell size={21} strokeWidth={2.4} />
        <CountBadge count={unreadCounts.total} style={{ top: -2, right: -4 }} />
      </button>

      <NotificationDropdownModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={bellRef}
        placement={placement}
      />
    </div>
  );
};
