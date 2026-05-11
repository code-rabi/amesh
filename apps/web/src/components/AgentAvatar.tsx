import { agentColor, agentInitials } from "../lib/agentColor.js";

type Props = {
  id: string;
  name: string;
  size?: number;
  title?: string;
};

export function AgentAvatar({ id, name, size = 32, title }: Props) {
  const palette = agentColor(id);
  return (
    <span
      className="agent-avatar"
      title={title ?? name}
      aria-hidden
      style={{
        width: size,
        height: size,
        background: palette.fill,
        color: palette.ink,
        fontSize: Math.max(10, Math.round(size * 0.4))
      }}
    >
      {agentInitials(name)}
    </span>
  );
}
