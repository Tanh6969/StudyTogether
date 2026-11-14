import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface WorkspaceTab {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Small trailing marker, e.g. a LIVE dot. */
  indicator?: ReactNode;
  title?: string;
}

interface WorkspaceTabsProps {
  /** Section title shown before the tabs (e.g. "Kênh chat"). */
  title: string;
  titleIcon?: ReactNode;
  tabs: WorkspaceTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Right-aligned actions (join by code, create, more menu...). */
  actions?: ReactNode;
  loading?: boolean;
  emptyLabel?: string;
  ariaLabel: string;
}

/**
 * Header of a group workspace section: section title + horizontally scrolling tabs + actions.
 * Tabs follow the WAI-ARIA tabs pattern (roving tabindex, ←/→/Home/End), vertical wheel scrolls
 * the strip horizontally, and edge fades signal hidden tabs.
 */
export function WorkspaceTabs({ title, titleIcon, tabs, activeId, onSelect, actions, loading, emptyLabel, ariaLabel }: WorkspaceTabsProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = () => {
    const el = stripRef.current;
    if (!el) return;
    setFade({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };

  useEffect(() => {
    updateFade();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabs.length]);

  // Keep the active tab in view when it changes (e.g. after creating a channel).
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const focusTab = (index: number) => {
    const buttons = stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const target = buttons?.[index];
    if (target) { target.focus(); onSelect(tabs[index].id); }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    if (event.key === 'ArrowRight') { event.preventDefault(); focusTab(index === last ? 0 : index + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focusTab(index === 0 ? last : index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusTab(0); }
    else if (event.key === 'End') { event.preventDefault(); focusTab(last); }
  };

  const mask = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent' : 'black'} 0, black 28px, black calc(100% - 28px), ${fade.right ? 'transparent' : 'black'} 100%)`
    : undefined;

  return (
    <div style={{height: 56, flexShrink: 0, padding: '0 16px 0 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 16, background: 'white'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, color: '#0F172A', fontSize: 15, fontWeight: 700}}>
        {titleIcon}
        <span>{title}</span>
      </div>
      <span aria-hidden="true" style={{width: 1, height: 20, background: '#E2E8F0', flexShrink: 0}} />

      <div
        ref={stripRef}
        role="tablist"
        aria-label={ariaLabel}
        className="workspace-tabs-strip"
        onScroll={updateFade}
        onWheel={event => {
          const el = stripRef.current;
          if (el && Math.abs(event.deltaY) > Math.abs(event.deltaX)) el.scrollLeft += event.deltaY;
        }}
        style={{flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'stretch', gap: 2, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', WebkitMaskImage: mask, maskImage: mask}}
      >
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="skeleton-pulse" style={{alignSelf: 'center', width: 88, height: 26, borderRadius: 6, flexShrink: 0}} />)
        ) : tabs.length === 0 ? (
          <span style={{alignSelf: 'center', color: '#94A3B8', fontSize: 13, whiteSpace: 'nowrap'}}>{emptyLabel}</span>
        ) : (
          tabs.map((tab, index) => {
            const selected = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected || (activeId === null && index === 0) ? 0 : -1}
                title={tab.title ?? tab.label}
                onClick={() => onSelect(tab.id)}
                onKeyDown={event => handleKeyDown(event, index)}
                className="workspace-tab"
                style={{
                  position: 'relative', flexShrink: 0, maxWidth: 220, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14,
                  fontWeight: selected ? 600 : 500, color: selected ? '#00236F' : '#64748B',
                  boxShadow: selected ? 'inset 0 -2px 0 #00236F' : 'none',
                }}
              >
                {tab.icon}
                <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{tab.label}</span>
                {tab.indicator}
              </button>
            );
          })
        )}
      </div>

      {actions && <div style={{display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0}}>{actions}</div>}
    </div>
  );
}

interface HeaderIconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}

/** 32px square icon button for WorkspaceTabs actions; label doubles as tooltip and aria-label. */
export function HeaderIconButton({ label, onClick, children, active, disabled }: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="workspace-icon-button"
      style={{width: 32, height: 32, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 8, background: active ? '#E2E8F0' : 'transparent', color: '#475569', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1}}
    >
      {children}
    </button>
  );
}
