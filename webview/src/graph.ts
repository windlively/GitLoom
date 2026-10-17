import type { Commit } from '../../src/shared/types';
export const COMMIT_ROW_HEIGHT = 24;
export const graphColors = [
  'var(--vscode-charts-blue, #3794ff)',
  'var(--vscode-charts-purple, #b180d7)',
  'var(--vscode-charts-green, #89d185)',
  'var(--vscode-charts-orange, #d18616)',
  'var(--vscode-charts-red, #f14c4c)',
  'var(--vscode-charts-yellow, #cca700)',
];
export function makeGraph(commits: Commit[]) {
  const lanes: string[] = [];
  const nodes = commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = lanes.indexOf('');
      if (lane === -1) lane = lanes.length;
      lanes[lane] = commit.hash;
    }
    lanes[lane] = '';
    commit.parents.forEach((parent, i) => {
      if (!lanes.includes(parent)) {
        if (i === 0 && !lanes[lane]) lanes[lane] = parent;
        else {
          const empty = lanes.indexOf('');
          if (empty === -1) lanes.push(parent);
          else lanes[empty] = parent;
        }
      }
    });
    return { commit, lane };
  });
  const index = new Map(nodes.map((node, i) => [node.commit.hash, { ...node, index: i }]));
  const edges = nodes.flatMap((node, i) =>
    node.commit.parents.map((parent) => {
      const target = index.get(parent);
      const x1 = node.lane * 18 + 20,
        y1 = i * COMMIT_ROW_HEIGHT + COMMIT_ROW_HEIGHT / 2;
      const x2 = (target?.lane ?? node.lane) * 18 + 20,
        y2 = (target?.index ?? commits.length) * COMMIT_ROW_HEIGHT + COMMIT_ROW_HEIGHT / 2;
      return {
        key: `${node.commit.hash}-${parent}`,
        color: graphColors[(target?.lane ?? node.lane) % graphColors.length],
        d:
          x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} L ${x1} ${y2 - COMMIT_ROW_HEIGHT / 2} Q ${x1} ${y2 - 5} ${x2} ${y2}`,
      };
    }),
  );
  return { nodes, edges, width: Math.max(70, ...nodes.map((node) => node.lane * 18 + 40)) };
}
