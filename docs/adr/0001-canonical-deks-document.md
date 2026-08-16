# ADR 0001: One canonical DEKS document

- Status: Accepted
- Date: 2026-08-16

## Decision

DEKS has one public document contract: the normalized JSON object identified only by
`format: "deks"`. Element identities, checkpoint states, assets, slides and adjacent transition
boundaries live in that document. Relational tables, renderer snapshots and `.deks` ZIP entries are
projections or containers; none is a second authoring format.

Every implementation validates and projects this same contract. The JSON Schema and golden fixture
are the executable compatibility boundary; there are no aliases, alternate shapes or conversion
paths inside the product.

## Consequences

- Hosts validate JSON before projecting it and preserve opaque canonical IDs without UUID coercion.
- Renderers resolve assets at runtime and keep DOM measurements outside the persisted document.
- Cloud policy may be stricter, but cannot change the portable schema.
