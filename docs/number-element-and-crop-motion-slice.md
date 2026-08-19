# Number element and crop motion — next vertical slice

Two additions that belong to the same slice because they solve the same problem: a figure is the
thing an audience remembers, and text that changes in place currently has no honest way to do it.

A number is not a text element that happens to contain digits. It carries a magnitude the product
can reason about, so it can count towards its value on the same curve that moves it, and it must
format identically in every host that opens the file. A crop is not a slide either: it moves the
content inside the element's own rectangle instead of moving the rectangle across the canvas, which
is what lets one figure replace another in the same position without the two of them dissolving
through each other.

## Portable document contract

### Number identity

```ts
interface NumberElement extends DeksElement {
  kind: "number";
  /** Which roles count. Declared once, on the element, not per slide. */
  animateMagnitude: { in: boolean; morph: boolean; out: boolean };
}
```

The toggles live on identity on purpose. Whether a figure is the kind of figure that counts is a
decision about that figure, made once; repeating it on every slide would let one checkpoint silently
disagree with the next, and the first thing anyone would ask is which one wins. What changes per
slide is the value, which is state.

Three separate booleans rather than one: a KPI that counts up on arrival, holds still while the
composition rearranges around it and simply leaves is the common case, and a single toggle cannot
express it.

### Number state

```ts
interface NumberElementState extends BaseElementState {
  value: number;
  decimals: number;                          // 0..6
  groupSeparator: "" | "," | "." | " " | "'";
  decimalSeparator: "." | ",";
  symbol: string;                            // "" when the number stands alone
  symbolPosition: "before" | "after";
  // plus the typography text already requires:
  // fontFamily, fontSize, fontWeight, lineHeight, letterSpacing,
  // horizontalAlignment, verticalAlignment, overflowMode, fill
}
```

There is no `content`. The digits are derived, and storing them would create a second source of
truth that drifts the moment someone edits the value.

Formatting is declared, never resolved from a locale. `Intl.NumberFormat` output depends on the ICU
build underneath the host, so a document formatted that way would render `1,234.5` on one machine
and `1.234,5` on another while claiming to be the same portable file. `groupSeparator: ""` disables
grouping. `symbol` is arbitrary and short — `%`, `$`, `USD`, `×`, `pts` — and is placed by
`symbolPosition`; it is a required field whose empty value means "no symbol", not an absent one.

Validation rejects a non-finite `value`, a `decimals` outside `0..6`, a `symbol` longer than 8
Unicode scalar values, and a `decimalSeparator` equal to the `groupSeparator`.

### Crop animation

```ts
type PresenceAnimation =
  | { kind: "none" }
  | { kind: "fade" }
  | { kind: "slide"; edge: MotionEdge; distance?: number }
  | { kind: "crop"; edge: MotionEdge }
  | { kind: "scale"; from: number };
```

One kind, not two. "Crop in" and "crop out" are this animation played in the `in` and `out` roles,
exactly as `slide` already works; adding a second kind would let a document declare a crop-out in an
`in` role and mean nothing.

No `distance`. The travel is the element's own extent along `edge`, because a partial crop is a
different effect — a reveal that stops halfway — and it should be asked for by name if it is ever
wanted.

## Renderer contract

`ElementSnapshot` gains `{ kind: "number", value, decimals, groupSeparator, decimalSeparator,
symbol, symbolPosition, animateMagnitude }` alongside the typography fields it shares with text.

Formatting is a pure function of the snapshot: sign, integer part grouped by `groupSeparator`,
`decimals` fraction digits after `decimalSeparator`, and `symbol` on the declared side. The renderer
must not call a locale formatter, and must render digits with tabular figures so a counting number
does not reflow its own box every frame. A number whose box is narrower than its final formatted
value is a layout defect, not something the count should paper over by shrinking.

The magnitude tween runs on the resolved duration, delay and easing of the role being played, from
the origin the specification defines: zero for `in`, zero for `out`, and the previous slide's value
for `morph`. Intermediate frames are formatted with the same `decimals` as the final one, so the
digits never gain and lose precision while counting. The last frame is the exact `value`. Reduced
motion, `durationBeats: 0`, `{kind:"none"}` and `{kind:"cut"}` all land on the final value
immediately; counting fast is not an accessible substitute for not counting.

`crop` applies a clip rectangle in the element's local space, before rotation, and translates the
content inside it by the element's own extent along `edge`: negative on `left` and `top`, positive
on `right` and `bottom`, arriving at zero for `in` and departing from zero for `out`. The element
rectangle itself never moves and opacity is never touched — those two facts are the whole effect.
The clip is imposed for the duration regardless of the state's `overflowMode` and released when the
animation ends, so an element that normally overflows keeps doing so once it has arrived.

`crop` composes with the geometry interpolation a `morph` role would otherwise perform, because a
crop only ever plays in `in` and `out`, where there is nothing to interpolate towards.

## Relational Cloud contract

- Extend `elements.kind` with `number`, and add the identity columns
  `animate_magnitude_in BOOLEAN NOT NULL`, `animate_magnitude_morph BOOLEAN NOT NULL` and
  `animate_magnitude_out BOOLEAN NOT NULL` to a joined subtype `number_elements`, keyed by `id` with
  `FOREIGN KEY (id) REFERENCES elements(id) ON DELETE CASCADE`.
- Add joined subtype `number_element_states`, keyed by `id` with
  `FOREIGN KEY (id) REFERENCES element_states(id) ON DELETE CASCADE`.
- Columns: `value DOUBLE PRECISION NOT NULL`, `decimals SMALLINT NOT NULL`,
  `group_separator VARCHAR(1) NOT NULL`, `decimal_separator VARCHAR(1) NOT NULL`,
  `symbol VARCHAR(8) NOT NULL`, `symbol_position VARCHAR(6) NOT NULL`.
- Checks: `decimals BETWEEN 0 AND 6`, `value BETWEEN -1e12 AND 1e12`,
  `group_separator IN ('', ',', '.', ' ', '''')`, `decimal_separator IN ('.', ',')`,
  `decimal_separator <> group_separator`, `symbol_position IN ('before','after')`.
- Crop needs no new table. It is a value of the existing motion animation column; extend that
  column's check constraint with `crop` and store its `edge` in the column `slide` already uses.
- Do not add JSON/JSONB. Both subtypes participate in clone, add-existing, undo/redo, import/export
  and the same `create_element` / `update_element_state` commands.

REST and MCP add these replaceable state fields to the existing command:

```text
kind="number"
value=38.5
decimals=1
group_separator=","
decimal_separator="."
symbol="%"
symbol_position="after"
```

and these to element creation:

```text
animate_magnitude_in=true
animate_magnitude_morph=true
animate_magnitude_out=false
```

## Export contract

PPTX has no counting number and no crop. Both export to their resting appearance: the number becomes
a text run carrying the formatted `value`, and a cropped element becomes the element at rest. An
export that silently dropped the figure or shipped a mid-count frame would be worse than an export
that is honestly static.

## Compatibility

Both additions widen closed unions that existing readers validate strictly, so a document using
either one fails to open in `@deks-js/document` 2.x rather than degrading. That makes this a major
version and it needs an ADR recording the decision, per this repository's rules. Documents that use
neither feature stay byte-identical and keep round-tripping through the same golden fixture.
