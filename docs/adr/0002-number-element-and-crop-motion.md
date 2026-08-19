# ADR 0002: Number element and crop motion

- Status: Accepted
- Date: 2026-08-19

## Decision

DEKS gains a `number` element kind and a `crop` presence animation.

A `number` carries a magnitude, not a string of digits. Its state declares `value` plus complete,
explicit formatting — `decimals`, `groupSeparator`, `decimalSeparator`, `symbol` and
`symbolPosition` — and derives what it renders from those fields. It stores no `content`, and hosts
must not resolve formatting from a locale.

Its identity declares `animateMagnitude: {in, morph, out}`: three booleans, on the element rather
than on its states. When the role being played is enabled, the magnitude tweens on that role's
resolved duration, delay and easing, from zero for `in`, to zero for `out`, and between the two
slides' values for `morph`.

A `crop` moves an element's content inside its own rectangle, which masks it, instead of moving the
rectangle across the canvas. It takes an `edge` and no `distance`, never touches opacity, and clips
for the duration regardless of `overflowMode`. It is one animation kind played in the `in` and `out`
roles, exactly as `slide` already is.

## Why

Two problems, one shape.

A figure is what an audience remembers, and a figure that counts towards its value on the same curve
that moves the element is the difference between a slide reporting a number and a slide making an
argument. Modelling it as text made that impossible: nothing in the document knew that `"+38%"` was
a quantity, so nothing could interpolate it, and every host that wanted the effect would have had to
parse digits back out of a string and invent its own formatting.

Formatting had to be declared rather than resolved because `Intl` output depends on the ICU build
underneath the host. A portable document that renders `1,234.5` on one machine and `1.234,5` on
another is not portable; it only looks portable until someone opens it somewhere else.

The toggles sit on identity because whether a figure is the kind of figure that counts is a decision
about that figure, made once. Per-state toggles would let one checkpoint disagree with the next, and
the only honest answer to "which one wins" would be an arbitrary rule nobody could predict. They are
three booleans rather than one because the common case — count up on arrival, hold still while the
composition rearranges, simply leave — cannot be expressed with fewer.

`crop` exists because text had no honest way to change in place. Fading is the obvious reach and the
wrong one: letterforms are thin and full of holes, so a half-opacity word reads as a rendering
defect, and when one line replaces another at the same position the two cross-dissolve through each
other until the audience can read neither. A crop lets the outgoing line leave behind its own
boundary while the incoming one arrives behind the same boundary, so two texts are never legible in
the same place at once. `slide` could not do this: it moves the rectangle, so the text is visible
outside its box and travels across the composition to say something that should have happened in
place.

## Consequences

- Both additions widen closed unions that existing readers validate strictly. A document using
  either one fails to open in `@deks-js/document` 2.x rather than degrading, so this is a major
  version. Documents using neither stay byte-identical.
- The renderer owns deterministic number formatting and must use tabular figures, so a counting
  number does not reflow its own box every frame.
- Reduced motion, `durationBeats: 0`, `{kind:"none"}` and `{kind:"cut"}` land on the final value
  immediately. Counting quickly is not an accessible substitute for not counting.
- PPTX export has neither feature and ships both at rest: the formatted `value`, and the element
  after its crop. An export cannot ship a mid-count frame.
- Relational hosts add two joined subtypes and extend the motion animation check constraint. Crop
  needs no new table; it reuses the column `slide` already stores its edge in.
- The design skill now tells authors to prefer `crop`, a short `slide` or a `cut` over a fade for
  text, and reserves fading for text that nothing replaces.

The vertical slice is specified in `docs/number-element-and-crop-motion-slice.md`.
