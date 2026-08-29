import type { DeksDocument, DeksElement } from "./presentation.js";

export type ElementGroupDocument = Pick<DeksDocument, "elements">;
export type ElementCollisionCandidatePredicate = (
  firstElementId: string,
  secondElementId: string,
) => boolean;

function elementIndex(document: ElementGroupDocument): Map<string, DeksElement> {
  return new Map(document.elements.map((element) => [element.id, element]));
}

function requireElement(elements: ReadonlyMap<string, DeksElement>, elementId: string): DeksElement {
  const element = elements.get(elementId);
  if (element === undefined) throw new Error(`unknown element ${elementId}`);
  return element;
}

function resolveEffectiveGroupId(
  elements: ReadonlyMap<string, DeksElement>,
  element: DeksElement,
): string | undefined {
  const visited = new Set<string>();
  let cursor = element.kind === "group" ? element : undefined;
  let parentId = element.parentId;
  let effectiveId = cursor?.id;

  while (parentId !== undefined) {
    if (visited.has(parentId)) throw new Error(`element ${element.id} has a cyclic group chain`);
    visited.add(parentId);
    cursor = requireElement(elements, parentId);
    if (cursor.kind !== "group") {
      throw new Error(`element ${element.id} parent ${cursor.id} is not a group`);
    }
    effectiveId = cursor.id;
    parentId = cursor.parentId;
  }

  return effectiveId;
}

/**
 * Returns the outermost logical group containing an element.
 *
 * Groups do not transform their descendants and need no slide state. Resolving
 * the outermost ancestor makes nested folders one collision-suppression scope.
 */
export function effectiveGroupId(
  document: ElementGroupDocument,
  elementId: string,
): string | undefined {
  const elements = elementIndex(document);
  return resolveEffectiveGroupId(elements, requireElement(elements, elementId));
}

/**
 * Builds an O(1)-per-pair identity filter for a collision scan.
 *
 * Two distinct rendered identities remain candidates unless they share the
 * same non-null effective group. Group identities themselves are logical and
 * never collision candidates, even if an older document gives one a state.
 */
export function createElementCollisionCandidatePredicate(
  document: ElementGroupDocument,
): ElementCollisionCandidatePredicate {
  const elements = elementIndex(document);
  const effectiveGroups = new Map<string, string | undefined>();
  for (const element of elements.values()) {
    effectiveGroups.set(element.id, resolveEffectiveGroupId(elements, element));
  }

  return (firstElementId, secondElementId) => {
    const first = requireElement(elements, firstElementId);
    const second = requireElement(elements, secondElementId);

    if (first.id === second.id || first.kind === "group" || second.kind === "group") return false;

    const firstGroupId = effectiveGroups.get(first.id);
    const secondGroupId = effectiveGroups.get(second.id);
    return firstGroupId === undefined || firstGroupId !== secondGroupId;
  };
}

/** Convenience form for checking one pair; use the compiled predicate for full scans. */
export function areElementsCollisionCandidates(
  document: ElementGroupDocument,
  firstElementId: string,
  secondElementId: string,
): boolean {
  return createElementCollisionCandidatePredicate(document)(firstElementId, secondElementId);
}
