# Product

## Register

product

## Users

Solo developers and hacker-operators running ACP-compatible coding agents across their own machines — homelab boxes, dev workstations, a personal VPS, the occasional cloud node. They live in a terminal, are comfortable with `curl | bash` installs, and reach for amesh when they want a single dashboard to see which nodes are up, which agents each node exposes, and what's flowing between them. The primary tasks on any given screen are: register a node, inspect agent health, open a chat with an agent, and define which agents may trigger which other agents.

## Product Purpose

amesh is a control plane for distributed coding agents. The dashboard exists so an operator can see and manipulate the live topology of nodes, agents, trigger edges, and sessions in real time. Success looks like an operator opening amesh, immediately understanding the state of their fleet, and acting on it without ceremony.

## Brand Personality

Precise, modern, restrained. The dashboard should feel like infrastructure — closer to Tailscale, Fly.io, or a Linear-grade tool than to a SaaS marketing page. Voice is direct and unadorned: "node offline" not "we couldn't reach this node right now." Information density is welcome; theatrics are not. The product should feel calm even when the underlying system is busy.

## Anti-references

- **Enterprise admin console sprawl**: AWS/Azure/Datadog-style gray-on-gray, dropdown soup, no visual hierarchy, every screen a settings page. amesh has fewer things on screen but each one is legible.
- **Generic SaaS-cream landing-dashboard mashups**: pastel gradients, hero-metric templates, friendly illustrations, rounded-everything. Wrong register.
- **AI-startup neon**: black + neon-gradient + glassmorphism + "agentic" marketing language. Category-reflex trap for this domain; explicitly avoid.
- **Corporate dev-tool boredom**: navy + Inter + white card grid that could be any B2B tool. The second-order reflex; avoid landing there by accident.

## Design Principles

1. **Show the topology, not just rows.** Nodes, agents, and trigger edges are the product. Default to representations that make the network visible — graphs, presence indicators, live edges — before falling back to tables.
2. **Respect the operator's time.** Dense, scannable, keyboard-friendly. No onboarding modals, no confirmation theater for reversible actions, no decorative chrome between the operator and the system state.
3. **Calm under live conditions.** State updates constantly. Animations and transitions should never strobe, jump, or pull attention away from what the operator is doing. Motion communicates change; it does not perform.
4. **Honesty over polish.** Pending, offline, error, and denied states are first-class. Show them truthfully — including timestamps, reasons, and audit trail — rather than papering them over with optimistic UI.
5. **One accent, used meaningfully.** Color carries status (online / offline / pending / denied), not decoration. Neutrals do the heavy lifting; the accent earns its appearances.

## Accessibility & Inclusion

MVP target is minimum viable: hit reasonable contrast on text and status indicators, keep keyboard focus visible, and don't fight framework defaults. Revisit for a formal WCAG pass once there are real users.
