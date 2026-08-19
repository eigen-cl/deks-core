# ADR 0003: Delay in beats, and the wipe animation

- Status: Accepted
- Date: 2026-08-19

## Decision

Every motion role gains `delayBeats`, defaulting to zero and required in the complete document
declaration. The delay a role waits is `floor(motionBeatMs * delayBeats + 0.5) + delayMs`: the two
units add, and neither replaces the other.

Presence motion gains `wipe`, which takes an `edge` and no distance. The element does not move at
all; the mask edge travels across it, uncovering it from `edge` in role `in` and covering it again in
role `out`.

## Why

**Delay had one unit and it was the wrong one for the common case.** The most frequent reason to
delay an element is to start it when another finishes, and that relationship is musical: it is "one
beat later", not "600 ms later". Expressed in milliseconds it works exactly until someone edits
`motionBeatMs`, and then every chain in the deck silently falls out of step — the animations still
play, nothing errors, and the choreography is simply wrong. `delayBeats` keeps that relationship
true through a tempo change.

Milliseconds still earn their place: a nudge that is about a specific instant rather than about the
rhythm should not stretch when the deck slows down. So the two add rather than one replacing the
other, and an author who wants "one beat plus a hair" can say so without picking a unit for both
halves.

**Wipe is the animation crop implied but could not express.** A crop moves the content inside a fixed
mask; the complement — a fixed element and a moving mask — is a different effect and reads
differently: a curtain opening over something already there, rather than something arriving from
behind a boundary. It is the right choice when the element must feel present and merely uncovered:
a chart revealed left to right, a list uncovered downwards, a figure that should not appear to fly
in. Neither can be expressed as a parameter of the other, because in one the content moves and in
the other it does not.

## Consequences

- `delayBeats` is required in `document.motion`, so this is a major version. Documents written
  against 3.x fail to open rather than silently defaulting.
- `wipe` renders as an animated `clip-path: inset(...)` on the element itself, with no wrapper. The
  clip resolves in the element's border box before its transform, so a rotated element wipes along
  its own axis, matching how `crop` behaves.
- Like `crop`, `wipe` never touches opacity: fading is what both of them exist to avoid.
- Hosts that surfaced only `delayMs` must expose both, or an author can no longer say what the
  document can express.
