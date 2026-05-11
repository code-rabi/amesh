<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: amesh
description: Control plane for distributed ACP coding agents.
---

# Design System: amesh

## 1. Overview

**Creative North Star: "The Quiet Mesh"**

amesh is a control plane for a fleet of coding agents the operator owns. The interface should feel like a workshop wall of switches and indicators rather than a SaaS product: warm graphite surfaces, a single technical sans doing all the work, status carried by color rather than by chrome. The operator opens it, sees the whole mesh at a glance, and acts. The mesh is busy underneath; the interface stays quiet.

The system explicitly rejects four neighbors. It is not a cream-and-pastel SaaS dashboard, not a gray-on-gray enterprise admin console, not a black-and-neon AI-startup landing page, and not the navy-Inter-white-card B2B default. It belongs to the same family as Tailscale, Fly.io, and Linear: infrastructure-grade, dense, restrained, with one accent that earns its appearances.

**Key Characteristics:**
- Warm graphite neutrals, tinted toward brown-charcoal rather than blue-gray
- One accent, used on roughly 10% of any screen, reserved for actions and identity
- Status colors live in their own register: online, offline, pending, denied, error
- A single technical sans (one family, multiple weights) carries everything
- Flat by default: depth comes from value, not shadow
- Motion responds to state changes; it never performs

## 2. Colors: The Warm Graphite Palette

The palette is built on warm-tinted near-blacks and near-whites, with one accent that holds the brand identity. Status colors form a parallel system, used only on status indicators, not as decoration.

### Primary

- **Operator Accent** (`[to be resolved during implementation]`): the system's single brand color. Lives in the warm graphite family but pulled toward a saturated counterpoint — most likely an amber, rust, or oxidized-copper hue dialed in OKLCH so it stays warm without becoming friendly. Used on primary actions, focused inputs, the selected tab, and the active edge in topology views. Never used as a background fill on large surfaces.

### Neutral

- **Ink** (`[to be resolved]`): the darkest readable text color. Warm graphite, not pure black. Used for primary text and high-contrast iconography.
- **Mute** (`[to be resolved]`): secondary text, metadata, timestamps, IDs. Roughly a step lighter than Ink.
- **Surface** (`[to be resolved]`): the dominant page surface. Light warm-graphite tint; carries 70–80% of the screen area.
- **Surface Raised** (`[to be resolved]`): one step up from Surface for nested regions that genuinely need separation. Used sparingly.
- **Line** (`[to be resolved]`): hairline dividers and borders. Always 1px, low contrast, never colored.

### Status

These live outside the brand palette and never mix with it.

- **Online** (`[to be resolved]`): connected, healthy, active.
- **Offline** (`[to be resolved]`): a tinted gray, deliberately the absence of color rather than red.
- **Pending** (`[to be resolved]`): registration in progress, awaiting heartbeat, queued.
- **Denied** (`[to be resolved]`): policy-blocked invocation. A muted warning hue, not the same as Error.
- **Error** (`[to be resolved]`): execution failure. Reserved; never used decoratively.

### Named Rules

**The One Accent Rule.** The Operator Accent appears on roughly 10% of any given screen. If it covers more, demote the surface or unsaturate it. The accent's rarity is what makes it readable as "the thing to act on."

**The Status-Is-Not-Brand Rule.** Status colors (online, offline, pending, denied, error) never mix with the brand accent. A pending node is not "branded pending"; it is pending.

**The Warm-Not-Cream Rule.** Neutrals lean warm but never reach pastel. If a swatch could appear on a real estate listing or a yoga studio site, it is too cream. Pull chroma down and lightness with it.

## 3. Typography

**Body Font:** A single technical sans (Inter Tight, Geist, IBM Plex Sans, or equivalent) `[exact family to be chosen at implementation]`.
**Mono Font:** A neutral monospace for IDs, hosts, payloads, and ACP traffic `[exact family to be chosen at implementation]`.

**Character:** One sans, multiple weights. The pairing is sans for everything visible to the operator, mono only where the data is itself code-shaped (node IDs, hostnames, request envelopes, JSON payloads). The system reads as one voice with a second register for raw data.

### Hierarchy

- **Display** (weight 600, ~32–40px, line-height 1.05): page-level headings only; one per screen. Used to anchor a route, not to decorate.
- **Headline** (weight 600, ~22px, line-height 1.15): panel and section titles.
- **Title** (weight 500, ~16px, line-height 1.3): card and list-item primary text.
- **Body** (weight 400, ~14px, line-height 1.45): everything else; max line length 65–75ch for any prose.
- **Label** (weight 500, ~11–12px, letter-spacing 0.06em, uppercase): status pills, metadata flags, table headers.
- **Mono** (weight 400, ~12–13px, line-height 1.4): IDs, hosts, JSON, ACP payloads, code blocks.

### Named Rules

**The One-Sans Rule.** No serif. No script. No second sans. Weight and size carry hierarchy; substituting another family is forbidden.

**The Mono-for-Code-Only Rule.** Mono appears only where the content is itself machine-shaped. UI copy, even when terse, stays in the sans. Mono used decoratively reads as costume.

## 4. Elevation

The system is flat by default. Depth comes from value contrast (Surface vs. Surface Raised) and from 1px lines, not from shadows. Shadows are not part of the resting state of any surface.

When a transient surface is genuinely floating (a popover, a command palette, a context menu), it gets a single ambient shadow defined in `.impeccable/design.json` motion/shadow tokens. Cards do not float. Panels do not float. Inputs do not float.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadow exists only on surfaces that are genuinely detached from the page flow.

**The No-Glass Rule.** No `backdrop-filter: blur`. Ever. The current `styles.css` glass panels are explicitly retired.

## 5. Components

`[Components will be documented in the next /impeccable document scan-mode pass, once the real UI is built. The current apps/web/src components are MVP scaffolding and are intentionally not captured here.]`

Until that pass, two primitives are normative as guardrails:

- **Buttons**: rectangular with small radius (~4–6px), never pill-shaped except for status indicators. Solid fill in Operator Accent for primary actions; subtle outline in Line for secondary; transparent with hover-on-Surface-Raised for tertiary. No gradients. No drop shadows. Hover changes color or background, not transform.
- **Status pills**: pill-shaped (`border-radius: 9999px`), `Label` typography, background tinted from the status color at low opacity (8–12%) over Surface, text in the full-saturation status color. The pill carries the color, the row does not.

## 6. Do's and Don'ts

### Do:

- **Do** anchor every screen on the live topology (nodes, agents, edges). Tables are a fallback, not a default. The mesh is the product; show it.
- **Do** use the Operator Accent on roughly 10% of any given screen and no more. Demote everything else to neutrals.
- **Do** use mono only for IDs, hosts, payloads, and ACP traffic. Sans carries every UI string.
- **Do** make every transient state honest: pending nodes say pending with a timestamp, offline nodes say offline with last_seen, denied invocations show the rule that blocked them.
- **Do** keep hairline dividers (1px, Line color). No thicker borders for emphasis.

### Don't:

- **Don't** introduce SaaS-cream backgrounds, pastel gradients, friendly illustrations, or the hero-metric template. PRODUCT.md rejects these by name.
- **Don't** lean on enterprise admin sprawl: dropdown soup, gray-on-gray, every screen a settings page. amesh has fewer things per screen, each one legible.
- **Don't** ship AI-startup neon: black + neon-gradient + glassmorphism + "agentic" language. Category-reflex trap, explicitly off-limits.
- **Don't** land in corporate dev-tool boredom: navy + Inter + white card grid. Second-order reflex; reject by feel.
- **Don't** use `backdrop-filter: blur` anywhere. No glassmorphism.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe accent. Banned in the shared design laws.
- **Don't** clip a gradient to text (`background-clip: text`). Solid color only.
- **Don't** wrap repeating items as identical icon-plus-heading-plus-text cards. If the data is uniform, it is a list or a table or a graph, not a card grid.
- **Don't** animate layout properties. Motion is restrained: state crossfades, edge pulses, focus ring transitions. No choreography.
- **Don't** reach for a modal as the first answer to a flow. Exhaust inline and progressive alternatives first.
- **Don't** restate headings in supporting copy. Every word earns its place.
- **Don't** use em dashes in any UI copy.
