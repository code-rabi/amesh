import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position
} from "@xyflow/react";

import type { TriggerMode } from "@amesh/protocol";

export type TriggerEdgeData = {
  mode: TriggerMode;
  sourceAgentName: string;
  targetAgentName: string;
  onFlip: () => void;
  onRemove: () => void;
};

type TriggerEdgeProps = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  markerEnd?: string;
  data?: { data: TriggerEdgeData };
};

export function TriggerEdge(props: TriggerEdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const mode = data?.data?.mode ?? "allow";

  return (
    <>
      <g data-mode={mode} className="react-flow__edge-trigger">
        <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      </g>
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
          }}
          className="nodrag nopan"
        >
          <div className="edge-menu" role="group" aria-label="edge controls">
            <button
              type="button"
              data-mode="allow"
              data-active={mode === "allow"}
              onClick={(event) => {
                event.stopPropagation();
                if (mode !== "allow") data?.data?.onFlip();
              }}
              title="Allow"
            >
              allow
            </button>
            <button
              type="button"
              data-mode="deny"
              data-active={mode === "deny"}
              onClick={(event) => {
                event.stopPropagation();
                if (mode !== "deny") data?.data?.onFlip();
              }}
              title="Deny"
            >
              deny
            </button>
            <span className="sep" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data?.data?.onRemove();
              }}
              title="Remove rule"
            >
              ×
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
