import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupAccessNotice } from './GroupAccessNotice';

describe('GroupAccessNotice for stale/direct group routes', () => {
  it('explains a left membership and routes the user to a rejoin path', () => {
    const onBack = vi.fn();
    render(<GroupAccessNotice reason="left" onBack={onBack} />);
    expect(screen.getByText('Bạn đã rời nhóm học này')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm và tham gia lại' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('does not imply a banned member can rejoin', () => {
    render(<GroupAccessNotice reason="banned" onBack={vi.fn()} />);
    expect(screen.getByText('Bạn không có quyền tham gia nhóm này')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tìm và tham gia lại' })).not.toBeInTheDocument();
  });

  it('surfaces membership loading errors instead of treating them as a revoked membership', () => {
    const onRetry = vi.fn();
    render(<GroupAccessNotice reason="error" onBack={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('Không thể xác minh tư cách thành viên')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
