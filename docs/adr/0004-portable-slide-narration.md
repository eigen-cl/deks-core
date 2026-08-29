# ADR 0004: Portable slide narration and embedded audio

- Status: Accepted
- Date: 2026-08-29

## Decision

Codec v3 adds one optional `narration` object to each slide. It contains the authored `script`,
explicit `pauseBeforeMs` and `pauseAfterMs`, and an optional audio reference with `assetId` plus
`provenance: "human-recorded" | "synthetic"`.

Narration audio is an ordinary embedded, content-addressed DEKS asset. The portable profile accepts
canonical integer PCM RIFF/WAV (`audio/wav`) and structurally canonical MPEG-1 Layer III
(`audio/mpeg`). Core sniffs and validates the bytes, enforces duration/size/format limits, and uses
the existing deterministic archive paths and hashes. Removing an asset still referenced by a
slide's narration is invalid.

Core owns no speech service integration and the visual renderer ignores narration. Voice choice,
generation, recording, consent evidence, playback and synchronization belong to Web/Desktop hosts.
Provider names, model IDs, runtime URLs and credentials never enter the portable document.

All four packages move together to `6.0.0` with exact internal dependency pins. This records the
breaking reader boundary but does not itself authorize publishing or tagging.

## Why

The script is durable authored content even when no audio has been produced. Keeping it separate
from the optional asset supports drafting, regeneration and local recording without inventing a
provider-specific document model. Per-slide audio also gives hosts explicit silence boundaries and
lets them retry or replace one segment without rebuilding a monolithic soundtrack.

WAV is required in the first slice because browsers and desktop hosts can produce mono 24 kHz PCM
offline without a transcoder. MP3 keeps generated and imported speech compact. Both need one strict
portable profile: accepting arbitrary container metadata or codecs would make cross-host validation,
duration limits and content addressing depend on platform decoders.

`human-recorded` and `synthetic` are intentionally provenance, not voice identity. A user-owned
voice model has consent and lifecycle obligations that cannot be proven by a portable presentation
file, so hosts must govern those records independently.

## Consequences

- v2 documents migrate to v3 without invented narration. Future codec versions remain rejected.
- A narration reference must resolve to an embedded supported audio asset; remote narration is not
  portable.
- Canonical WAV is deliberately narrow: PCM, 16/24-bit, mono/stereo, 8–48 kHz, with no extra chunks.
- Canonical MP3 is deliberately narrow: complete MPEG-1 Layer III frames, stable rate/channel mode,
  and no ID3 or trailing data.
- Audio is bounded to 50 MB and 10 minutes per asset. Archive-wide limits continue to apply.
- Visual snapshots and transitions are unchanged. Hosts that want narrated playback compose the
  renderer with their own audio clock and policy.
- Older v2-only readers cannot open v3 files, which requires a coordinated package/consumer rollout.
