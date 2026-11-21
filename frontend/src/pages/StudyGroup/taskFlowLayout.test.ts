import { describe, expect, it } from 'vitest';
import type { GroupTask } from '../../lib/groupTask.api';
import { arrangeTasks, CARD_WIDTH, connectorPath, type NodePosition } from './taskFlowLayout';

function task(id: string, extra: Partial<GroupTask> = {}): GroupTask {
  return {
    id, group_id: 'g', parent_id: null, roadmap_id: null, title: id, assignee: '', due_date: null, done: false,
    notes: [], position: null, created_by: null, created_at: '', updated_at: '', ...extra,
  };
}

const byId = (positions: NodePosition[]) => new Map(positions.map(position => [position.task.id, position]));
const overlaps = (a: NodePosition, b: NodePosition) =>
  a.x < b.x + CARD_WIDTH && b.x < a.x + CARD_WIDTH && a.y < b.y + b.height && b.y < a.y + a.height;

describe('arrangeTasks', () => {
  it('lays phases left to right and stacks subtasks under their phase', () => {
    const at = byId(arrangeTasks([task('p1'), task('p2'), task('c1', { parent_id: 'p1' })], {}));
    expect(at.get('p2')!.x).toBeGreaterThan(at.get('p1')!.x + CARD_WIDTH);
    expect(at.get('p2')!.y).toBe(at.get('p1')!.y);
    expect(at.get('c1')!.y).toBeGreaterThan(at.get('p1')!.y + at.get('p1')!.height);
    expect(at.get('c1')!.x).toBeGreaterThan(at.get('p1')!.x);
  });

  it('moves a dragged card\'s subtree with it', () => {
    const at = byId(arrangeTasks([
      task('p1', { position: { x: 900, y: 500 } }),
      task('a', { parent_id: 'p1' }),
      task('b', { parent_id: 'p1' }),
    ], {}));
    const parent = at.get('p1')!, a = at.get('a')!, b = at.get('b')!;
    expect(a.x).toBe(parent.x + 34);
    expect(a.y).toBeGreaterThan(parent.y + parent.height);
    expect(b.y).toBeGreaterThan(a.y + a.height);
  });

  it('puts a newly applied AI roadmap in its own lane below every older card, dragged ones included', () => {
    const positions = arrangeTasks([
      task('old1'),
      task('old2', { position: { x: 400, y: 700 } }),
      task('ai1', { roadmap_id: 'r1' }),
      task('ai2', { roadmap_id: 'r1' }),
      task('aiChild', { roadmap_id: 'r1', parent_id: 'ai1' }),
    ], {});
    const at = byId(positions);
    const oldBottom = Math.max(...['old1', 'old2'].map(id => at.get(id)!.y + at.get(id)!.height));
    for (const id of ['ai1', 'ai2', 'aiChild']) expect(at.get(id)!.y).toBeGreaterThan(oldBottom);
    for (const a of positions) for (const b of positions) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it('uses measured heights so tall cards never overlap the card below', () => {
    const at = byId(arrangeTasks([task('p'), task('c', { parent_id: 'p' })], { p: 400 }));
    expect(at.get('c')!.y).toBeGreaterThanOrEqual(at.get('p')!.y + 400);
  });
});

describe('connectorPath', () => {
  const node = (id: string, x: number, y: number, parentId?: string): NodePosition =>
    ({ task: task(id), x, y, height: 120, parentId });

  it('draws a tree elbow to an indented child below', () => {
    expect(connectorPath(node('p', 0, 0), node('c', 34, 200, 'p'))).toMatch(/^M 16 120 L 16 218 L 34 218$/);
  });

  it('leaves from the left edge when the target is to the left', () => {
    expect(connectorPath(node('p', 600, 0), node('c', 0, 300, 'p'))).toMatch(/^M 600 18 C/);
  });

  it('goes bottom to top when the target is below but not indented', () => {
    expect(connectorPath(node('p', 100, 0), node('c', 40, 300, 'p'))).toMatch(/^M 225 120 C .* 165 300$/);
  });
});
