import type { Commit } from '../../src/shared/types';

export const COMMIT_ROW_HEIGHT = 24;

// Compact swimlanes and rounded elbows follow VS Code's Source Control Graph.
const LANE_WIDTH = COMMIT_ROW_HEIGHT / 2;
const CURVE_RADIUS = 5;
const PALETTE = [
  'var(--vscode-scmGraph-foreground1, #ffb000)',
  'var(--vscode-scmGraph-foreground2, #dc267f)',
  'var(--vscode-scmGraph-foreground3, #994f00)',
  'var(--vscode-scmGraph-foreground4, #40b0a6)',
  'var(--vscode-scmGraph-foreground5, #b66dff)',
];
const HEAD_COLOR = 'var(--vscode-scmGraph-historyItemRefColor, var(--vscode-charts-blue, #3794ff))';
const TAG_COLOR = 'var(--vscode-scmGraph-historyItemBaseRefColor, #ea5c00)';

export const graphColors = PALETTE;

type Swimlane = { id: string; color: string };
type RowKind = 'head' | 'merge' | 'normal';

export type GraphNode = {
  commit: Commit;
  lane: number;
  x: number;
  color: string;
  kind: RowKind;
};

export type GraphEdge = { key: string; d: string; color: string };

type GraphRow = {
  commit: Commit;
  input: Swimlane[];
  output: Swimlane[];
  lane: number;
  color: string;
  kind: RowKind;
};

const refColor = (commit: Commit) => {
  if (commit.refs.some((ref) => ref.startsWith('HEAD -> '))) return HEAD_COLOR;
  if (commit.refs.some((ref) => ref.startsWith('tag: '))) return TAG_COLOR;
  return undefined;
};

const kindOf = (commit: Commit): RowKind => {
  if (commit.refs.some((ref) => ref.startsWith('HEAD -> '))) return 'head';
  return commit.parents.length > 1 ? 'merge' : 'normal';
};

export function makeGraph(commits: Commit[]) {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const rows: GraphRow[] = [];
  let previous: Swimlane[] = [];
  let colorIndex = -1;
  let lanes = 1;
  const nextColor = () => PALETTE[(colorIndex = (colorIndex + 1) % PALETTE.length)];

  for (const commit of commits) {
    const input = previous.map((lane) => ({ ...lane }));
    const output: Swimlane[] = [];
    let firstParentAdded = false;

    for (const lane of input) {
      if (lane.id === commit.hash) {
        if (commit.parents.length && !firstParentAdded) {
          output.push({ id: commit.parents[0], color: refColor(commit) ?? lane.color });
          firstParentAdded = true;
        }
        continue;
      }
      output.push({ ...lane });
    }

    for (let i = firstParentAdded ? 1 : 0; i < commit.parents.length; i++) {
      const parent = i === 0 ? commit : byHash.get(commit.parents[i]);
      const color = (i === 0 ? refColor(commit) : parent ? refColor(parent) : undefined) ?? nextColor();
      output.push({ id: commit.parents[i], color });
    }

    const inputIndex = input.findIndex((lane) => lane.id === commit.hash);
    const lane = inputIndex !== -1 ? inputIndex : input.length;
    const color =
      inputIndex !== -1
        ? commit.parents.length && output[lane]?.id === commit.parents[0]
          ? output[lane].color
          : input[inputIndex].color
        : (output[lane]?.color ?? refColor(commit) ?? HEAD_COLOR);
    lanes = Math.max(lanes, input.length, output.length, lane + 1);
    rows.push({ commit, input, output, lane, color, kind: kindOf(commit) });
    previous = output;
  }

  const edges: GraphEdge[] = [];
  const nodes: GraphNode[] = [];
  // rowEdges[i] is the index of the first edge drawn in row i, so a visible row range maps to an edge slice.
  const rowEdges: number[] = [];
  const center = (index: number) => (index + 1) * LANE_WIDTH;
  const left = (index: number) => index * LANE_WIDTH;
  const lastIndexOf = (lanes: Swimlane[], id: string) => {
    for (let i = lanes.length - 1; i >= 0; i--) if (lanes[i].id === id) return i;
    return -1;
  };

  rows.forEach((row, rowIndex) => {
    rowEdges.push(edges.length);
    const { commit, input, output } = row;
    const top = rowIndex * COMMIT_ROW_HEIGHT;
    const middle = top + COMMIT_ROW_HEIGHT / 2;
    const bottom = top + COMMIT_ROW_HEIGHT;
    const inputIndex = input.findIndex((lane) => lane.id === commit.hash);
    let outputIndex = 0;

    input.forEach((lane, index) => {
      if (lane.id === commit.hash) {
        if (index !== row.lane) {
          edges.push({
            key: `${commit.hash}-base-${index}`,
            color: lane.color,
            d: `M ${center(index)} ${top} A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${left(index)} ${middle} H ${center(row.lane)}`,
          });
        } else if (commit.parents.length) {
          outputIndex++;
        }
      } else if (outputIndex < output.length && lane.id === output[outputIndex].id) {
        if (index === outputIndex) {
          edges.push({
            key: `${commit.hash}-lane-${index}`,
            color: lane.color,
            d: `M ${center(index)} ${top} V ${bottom}`,
          });
        } else {
          const from = center(index);
          const to = center(outputIndex);
          edges.push({
            key: `${commit.hash}-shift-${index}`,
            color: lane.color,
            d: `M ${from} ${top} V ${top + 6} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${from - CURVE_RADIUS} ${middle} H ${to + CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${to} ${middle + CURVE_RADIUS} V ${bottom}`,
          });
        }
        outputIndex++;
      }
    });

    for (let i = 1; i < commit.parents.length; i++) {
      const parentIndex = lastIndexOf(output, commit.parents[i]);
      if (parentIndex === -1) continue;
      edges.push({
        key: `${commit.hash}-merge-${i}`,
        color: output[parentIndex].color,
        d: `M ${left(parentIndex)} ${middle} A ${LANE_WIDTH} ${LANE_WIDTH} 0 0 1 ${center(parentIndex)} ${bottom} M ${left(parentIndex)} ${middle} H ${center(row.lane)}`,
      });
    }

    if (inputIndex !== -1) {
      edges.push({
        key: `${commit.hash}-head`,
        color: input[inputIndex].color,
        d: `M ${center(row.lane)} ${top} V ${middle}`,
      });
    }
    if (commit.parents.length) {
      edges.push({
        key: `${commit.hash}-tail`,
        color: row.color,
        d: `M ${center(row.lane)} ${middle} V ${bottom}`,
      });
    }

    nodes.push({ commit, lane: row.lane, x: center(row.lane), color: row.color, kind: row.kind });
  });

  rowEdges.push(edges.length);
  return { nodes, edges, rowEdges, width: Math.max(64, Math.ceil((lanes + 1) * LANE_WIDTH + 4)) };
}
