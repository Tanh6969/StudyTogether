import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TaskFlowBoard } from './TaskFlowBoard';
import { createGroupTask, listGroupTasks, updateGroupTask, type GroupTask } from '../../lib/groupTask.api';
vi.mock('../../hooks/useLiveCollectionRefresh', () => ({ useLiveCollectionRefresh: () => {} }));
vi.mock('../../lib/groupTask.api', () => ({
  AI_MAX_HORIZON_DAYS: 730, listGroupTasks: vi.fn(), createGroupTask: vi.fn(), updateGroupTask: vi.fn(),
  deleteGroupTask: vi.fn(), applyGroupTaskTree: vi.fn(), generateGroupTaskTree: vi.fn(), getGroupTaskAiQuota: vi.fn(),
}));
const task: GroupTask = {
  id: 't1', group_id: 'g1', parent_id: null, title: 'Nhiệm vụ gốc', assignee: '', due_date: null,
  done: false, notes: [], position: null, created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
let rows: GroupTask[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  rows = [];
  vi.mocked(listGroupTasks).mockImplementation(async () => rows.map(t => ({ ...t })));
  vi.mocked(createGroupTask).mockImplementation(async (_group, data) => {
    const created = { ...task, ...data, due_date: data.due_date ?? null };
    rows.push(created);
    return created;
  });
  vi.mocked(updateGroupTask).mockImplementation(async (_group, id, changes) => {
    rows = rows.map(t => t.id === id ? { ...t, ...changes } : t);
    return rows.find(t => t.id === id)!;
  });
});
function openDeadline(title = task.title) {
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa hạn hoàn thành: ' + title }));
}
async function setDeadline(value: string, title = task.title) {
  openDeadline(title);
  fireEvent.change(screen.getByLabelText('Hạn mục tiêu'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu hạn' }));
  await waitFor(() => expect(screen.queryByLabelText('Hạn mục tiêu')).not.toBeInTheDocument());
}
describe('group task deadline lifecycle', () => {
  it('creates without a date, adds, changes and removes the deadline, including after reload', async () => {
    const view = render(<TaskFlowBoard groupId="g1" />);
    await screen.findByText('Thêm nhiệm vụ đầu tiên để bắt đầu sơ đồ nhóm.');
    fireEvent.change(screen.getByLabelText('Tên nhiệm vụ'), { target: { value: task.title } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhiệm vụ' }));
    await screen.findByRole('button', { name: 'Chỉnh sửa hạn hoàn thành: ' + task.title });
    expect(createGroupTask).toHaveBeenCalledWith('g1', { title: task.title, due_date: null, parent_id: null });
    await setDeadline('2090-12-01');
    expect(rows[0].due_date).toBe('2090-12-01');
    await setDeadline('2090-12-02');
    view.unmount();
    render(<TaskFlowBoard groupId="g1" />);
    await screen.findByRole('button', { name: 'Chỉnh sửa hạn hoàn thành: ' + task.title });
    openDeadline();
    expect(screen.getByLabelText('Hạn mục tiêu')).toHaveValue('2090-12-02');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ hạn' }));
    await waitFor(() => expect(screen.queryByLabelText('Hạn mục tiêu')).not.toBeInTheDocument());
    expect(rows[0].due_date).toBeNull();
  });
  it('supports child and AI-generated completed tasks without changing their other fields', async () => {
    rows = [task, { ...task, id: 'child', title: 'Nhiệm vụ con', parent_id: task.id, roadmap_id: 'ai', done: true }];
    render(<TaskFlowBoard groupId="g1" />);
    await screen.findByRole('button', { name: 'Chỉnh sửa hạn hoàn thành: Nhiệm vụ con' });
    await setDeadline('2090-10-01', 'Nhiệm vụ con');
    expect(rows[1]).toMatchObject({ parent_id: task.id, roadmap_id: 'ai', done: true, due_date: '2090-10-01' });
    expect(rows[0].due_date).toBeNull();
  });
  it('keeps draft on save failure and supports retry', async () => {
    rows = [task];
    vi.mocked(updateGroupTask).mockRejectedValueOnce(new Error('offline'));
    render(<TaskFlowBoard groupId="g1" />);
    await screen.findByRole('button', { name: 'Chỉnh sửa hạn hoàn thành: ' + task.title });
    openDeadline();
    fireEvent.change(screen.getByLabelText('Hạn mục tiêu'), { target: { value: '2090-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hạn' }));
    await screen.findByText('Không lưu được hạn hoàn thành. Vui lòng thử lại.');
    expect(screen.getByLabelText('Hạn mục tiêu')).toHaveValue('2090-12-01');
    expect(rows[0].due_date).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hạn' }));
    await waitFor(() => expect(screen.queryByLabelText('Hạn mục tiêu')).not.toBeInTheDocument());
    expect(rows[0].due_date).toBe('2090-12-01');
  });
});
