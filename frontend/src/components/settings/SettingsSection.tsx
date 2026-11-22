import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Shared look for every card on the Account Settings page (AccountSettingsPage.tsx):
 *  icon + title + one-line description, then the body under a thin divider.
 *  Phones get tighter padding (16px) and slightly smaller titles; from 640px 24px padding.
 *  `scroll-mt-*` keeps the title clear of the sticky header / section tabs when the page
 *  scrolls to a section from the settings navigation. */
export function SettingsSection({ id, icon: Icon, title, description, action, children, className = '' }: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Optional control shown at the right of the header (e.g. "Đổi mật khẩu" toggle). */
  action?: ReactNode;
  /** Body. Omit for a header-only card. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-32 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:scroll-mt-36 sm:p-6 lg:scroll-mt-24 ${className}`}
    >
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF3FF] text-[#00236F]">
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="m-0 text-base font-semibold leading-6 text-[#0B1C30] sm:text-lg">
            {title}
          </h2>
          {description && <p className="m-0 mt-0.5 text-[13px] leading-5 text-[#444651] sm:text-sm">{description}</p>}
        </div>
        {action && <div className="shrink-0 self-center">{action}</div>}
      </header>
      {children && <div className="mt-4 border-t border-slate-100 pt-4 sm:mt-5 sm:pt-5">{children}</div>}
    </section>
  );
}

/** Text inputs on this page. 16px text on phones stops iOS Safari from zooming in on focus. */
export const SETTINGS_INPUT =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-[#0B1C30] outline-none transition placeholder:text-slate-400 focus:border-[#00236F] focus:ring-4 focus:ring-[#00236F]/10 sm:h-10 sm:text-sm';

export const SETTINGS_LABEL = 'flex flex-col gap-1.5 text-[13px] font-semibold text-[#0B1C30]';

export const SETTINGS_BTN_PRIMARY =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border-none bg-[#00236F] px-5 text-sm font-semibold text-white transition hover:bg-[#001a52] disabled:cursor-not-allowed disabled:bg-[#93A4C7] sm:h-10';

export const SETTINGS_BTN_SECONDARY =
  'inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10';
