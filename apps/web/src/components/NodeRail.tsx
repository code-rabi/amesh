import type { NodeRecord } from "@amesh/protocol";

type Props = {
  nodes: NodeRecord[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
};

export function NodeRail({ nodes, selectedNodeId, onSelect }: Props) {
  const sorted = [...nodes].sort((left, right) => {
    const leftOnline = left.status === "online" ? 0 : 1;
    const rightOnline = right.status === "online" ? 0 : 1;
    if (leftOnline !== rightOnline) {
      return leftOnline - rightOnline;
    }
    return left.name.localeCompare(right.name);
  });

  return (
    <nav className="node-rail" aria-label="Nodes">
      <button
        type="button"
        className="node-rail__all"
        data-selected={selectedNodeId === null}
        onClick={() => onSelect(null)}
      >
        <span className="node-rail__name">All nodes</span>
      </button>
      <ul className="node-rail__list">
        {sorted.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="node-rail__item"
              data-selected={selectedNodeId === node.id}
              data-status={node.status}
              onClick={() => onSelect(node.id)}
              title={`${node.name} · ${node.host}`}
            >
              <span className="node-rail__row">
                <span className="node-rail__status" data-status={node.status} aria-hidden />
                <span className="node-rail__name">{node.name}</span>
              </span>
              <span className="node-rail__meta">{node.host}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
