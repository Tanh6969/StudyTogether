/**
 * Pure layout for TaskFlowBoard: where each task card goes and how links between cards are drawn.
 * Kept free of React so it can be unit-tested.
 */
import type { GroupTask } from '../../lib/groupTask.api';

export const CARD_WIDTH = 250;
const CARD_BASE_HEIGHT = 142; // header + status row + footer, before notes
export const HEADER_MID = 18;   // vertical centre of a card's title bar, where connectors attach
const DEPTH_INDENT = 34; // each level below a phase shifts right by this much inside its column
const ROW_GAP = 18;
const COLUMN_GAP = 110;  // room for the phase -> phase arrow
const LANE_GAP = 90;     // vertical space between two roadmaps

export interface NodePosition { task: GroupTask; x: number; y: number; height: number; parentId?: string; }

/** Rough card height before the real one is measured: each note adds a few wrapped lines. */
function estimateHeight(task: GroupTask): number {
  return CARD_BASE_HEIGHT + task.notes.reduce((sum, note) => sum + 9 + Math.ceil(note.length / 40) * 15, 0);
}

/** Lane a root belongs to: one per applied AI roadmap, plus one for hand-made phases. */
export const laneKey = (task: GroupTask) => task.roadmap_id ?? 'manual';

/**
 * Roadmap layout.
 * - Lanes: each applied AI roadmap (roadmap_id) is its own row; hand-made phases share one.
 *   A lane starts below everything drawn in earlier lanes (dragged cards included), so a new
 *   roadmap never lands on top of an old one.
 * - Inside a lane every root task is a phase column, left to right in board order.
 * - Subtasks stack beneath their parent, indented one step per level, and always follow the
 *   parent's actual position -- if the user dragged a card, its subtree moves with it.
 * Nodes the user dragged keep their saved position.
 */
export function arrangeTasks(tasks: GroupTask[], measured: Record<string, number>): NodePosition[] {
  const ids = new Set(tasks.map(task => task.id));
  const children = new Map<string | undefined, GroupTask[]>();
  for (const task of tasks) {
    const parentId = task.parent_id && ids.has(task.parent_id) ? task.parent_id : undefined;
    children.set(parentId, [...(children.get(parentId) ?? []), task]);
  }
  const lanes = new Map<string, GroupTask[]>();
  for (const root of children.get(undefined) ?? []) lanes.set(laneKey(root), [...(lanes.get(laneKey(root)) ?? []), root]);

  const positions: NodePosition[] = [];
  let laneTop = 28;
  for (const roots of lanes.values()) {
    let columnX = 36;
    let laneBottom = laneTop;
    for (const root of roots) {
      let columnRight = columnX; // right edge of this column's auto-placed ("in flow") cards
      /** Places `task` and its subtree; returns where the parent's next child should start. */
      const place = (task: GroupTask, autoX: number, autoY: number, parentInFlow: boolean, parentId?: string): number => {
        const height = measured[task.id] ?? estimateHeight(task);
        const inFlow = parentInFlow && !task.position;
        const x = task.position?.x ?? autoX;
        const y = task.position?.y ?? autoY;
        positions.push({ task, x, y, height, parentId });
        laneBottom = Math.max(laneBottom, y + height);
        if (inFlow) columnRight = Math.max(columnRight, x + CARD_WIDTH);
        let cursor = y + height + ROW_GAP;
        for (const child of children.get(task.id) ?? []) cursor = place(child, x + DEPTH_INDENT, cursor, inFlow, task.id);
        return task.position ? autoY : cursor; // a dragged card's subtree lives elsewhere
      };
      place(root, columnX, laneTop, true);
      if (columnRight > columnX) columnX = columnRight + COLUMN_GAP;
    }
    laneTop = laneBottom + LANE_GAP;
  }
  return positions;
}

/**
 * One connector style for every link (phase -> phase and parent -> child). Picks the facing
 * sides from where the two cards actually are, so links stay short and never cut across a card:
 * - child indented right below its parent (auto layout) -> file-tree elbow from the parent's rail
 * - target clearly right / left -> horizontal curve between the facing side edges
 * - otherwise (stacked) -> vertical curve between bottom and top edges
 */
export function connectorPath(from: NodePosition, to: NodePosition): string {
  const fromMid = from.y + HEADER_MID, toMid = to.y + HEADER_MID;
  const isTreeChild = to.parentId === from.task.id
    && to.x >= from.x + 10 && to.x <= from.x + CARD_WIDTH / 2 && to.y >= from.y + from.height - 1;
  if (isTreeChild) {
    const railX = from.x + 16;
    return `M ${railX} ${from.y + from.height} L ${railX} ${toMid} L ${to.x} ${toMid}`;
  }
  if (to.x >= from.x + CARD_WIDTH + 24) {
    const startX = from.x + CARD_WIDTH, bend = Math.max(30, Math.min(80, (to.x - startX) / 2));
    return `M ${startX} ${fromMid} C ${startX + bend} ${fromMid}, ${to.x - bend} ${toMid}, ${to.x} ${toMid}`;
  }
  if (to.x + CARD_WIDTH + 24 <= from.x) {
    const endX = to.x + CARD_WIDTH, bend = Math.max(30, Math.min(80, (from.x - endX) / 2));
    return `M ${from.x} ${fromMid} C ${from.x - bend} ${fromMid}, ${endX + bend} ${toMid}, ${endX} ${toMid}`;
  }
  const fromCx = from.x + CARD_WIDTH / 2, toCx = to.x + CARD_WIDTH / 2;
  if (to.y >= from.y + from.height) {
    const startY = from.y + from.height, bend = Math.max(24, Math.min(80, (to.y - startY) / 2));
    return `M ${fromCx} ${startY} C ${fromCx} ${startY + bend}, ${toCx} ${to.y - bend}, ${toCx} ${to.y}`;
  }
  const endY = to.y + to.height, bend = Math.max(24, Math.min(80, (from.y - endY) / 2));
  return `M ${fromCx} ${from.y} C ${fromCx} ${from.y - bend}, ${toCx} ${endY + bend}, ${toCx} ${endY}`;
}

