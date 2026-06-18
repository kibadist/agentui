# Changelog

All notable changes to `@kibadist/agentui-svg` are documented here.

## 1.4.0

### Added

- Initial release of the SVG-native Agent UI component layer — zero-dependency,
  framework-agnostic Web Components.
- `agentui-workflow-canvas` — node/edge graph of an agent flow with auto layered
  layout, pan/zoom, node + edge selection, and status styling.
- `agentui-tool-timeline` — ordered tool-call run with status, duration, detail,
  compact/expanded density, and empty/loading/error states.
- `agentui-review-checkpoint` — human approval gate emitting continue/stop/revise
  decisions with an optional note; low/medium/high levels; disabled/loading
  states; optional preview slot.
- `agentui-memory-map` — context/memory graph with typed nodes, relevance-weighted
  links, grouped layout, and select/edit/remove events.
- `agentui-state-machine` — state + transition viewer with active-state emphasis,
  horizontal and radial layouts, and state selection.
- Shared foundation: `AgentUIElement` base class (shadow DOM, coalesced render,
  event delegation), CSS-custom-property theming, reusable SVG filter defs, and an
  accessibility baseline (keyboard activation, roles, labels, focus ring).
- `register` entry and `registerAll()` for idempotent custom-element registration.

### Fixed

- `agentui-tool-timeline` rows now have a full-width transparent hit area, so a
  click anywhere on a row selects it (previously only the painted dot/label/chip
  were clickable).
