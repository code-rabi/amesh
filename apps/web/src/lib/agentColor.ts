// Deterministic warm-leaning OKLCH hues for agent avatars.
// Chosen so any single avatar reads as a quiet identity dot, not decoration.
// We stay clear of green/blue dominance and keep chroma low.
const HUES = [55, 30, 85, 200, 260, 320, 15, 100, 170];

function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function agentHue(id: string): number {
  return HUES[hash(id) % HUES.length] ?? 55;
}

export function agentColor(id: string) {
  const hue = agentHue(id);
  return {
    fill: `oklch(76% 0.07 ${hue})`,
    ink: `oklch(28% 0.06 ${hue})`,
    ring: `oklch(58% 0.14 ${hue})`,
    soft: `oklch(76% 0.07 ${hue} / 0.18)`
  };
}

export function agentInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_./]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
