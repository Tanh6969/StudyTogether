import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardSlider } from './StudyGroups';

/** jsdom does no layout: fake a row that is 300px wide, scrolls to 900px, cards 142px. */
function fakeLayout(row: HTMLElement, scrollLeft: number) {
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 900 });
  Object.defineProperty(row, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
  for (const card of Array.from(row.children)) {
    Object.defineProperty(card, 'offsetWidth', { configurable: true, value: 142 });
  }
}

function renderSlider() {
  render(
    <CardSlider label="Nhóm học của tôi">
      {[1, 2, 3, 4, 5, 6].map((n) => <div key={n}>Nhóm {n}</div>)}
    </CardSlider>,
  );
  return screen.getByRole('region', { name: 'Nhóm học của tôi' });
}

describe('CardSlider (2–5 card slider)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows ← → buttons when the row overflows and enables them by scroll position', () => {
    const row = renderSlider();
    fakeLayout(row, 0);
    act(() => { fireEvent.scroll(row); });

    expect(screen.getByRole('button', { name: 'Xem nhóm trước' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xem nhóm tiếp theo' })).toBeEnabled();

    fakeLayout(row, 600); // scrolled to the end
    act(() => { fireEvent.scroll(row); });
    expect(screen.getByRole('button', { name: 'Xem nhóm trước' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Xem nhóm tiếp theo' })).toBeDisabled();
  });

  it('moves by one page of fully visible cards per press', () => {
    const row = renderSlider();
    fakeLayout(row, 0);
    row.style.columnGap = '16px';
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy as unknown as typeof row.scrollBy;
    act(() => { fireEvent.scroll(row); });

    fireEvent.click(screen.getByRole('button', { name: 'Xem nhóm tiếp theo' }));
    // 300px row, 142px cards + 16px gap → 2 fully visible cards → 2 × 158 = 316px
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 316, behavior: 'smooth' });
  });

  it('hides the buttons when everything already fits (nothing to slide)', () => {
    renderSlider(); // jsdom default: scrollWidth = clientWidth = 0
    expect(screen.queryByRole('button', { name: 'Xem nhóm tiếp theo' })).not.toBeInTheDocument();
  });
});
