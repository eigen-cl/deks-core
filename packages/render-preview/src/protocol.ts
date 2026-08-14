import type { LayoutMeasurement, Rect } from "@deks-js/renderer-core";

export interface WorkerLayoutMeasurement {
  element_id: string;
  rect: Rect;
  visual_aabb: Rect;
  content_rect?: Rect;
  overflow_status?: "fits" | "overflow";
  measurement_source: "dom";
}

/** Serialize portable renderer measurements at the language-neutral worker boundary. */
export function workerLayoutMeasurements(measurements: LayoutMeasurement[]): WorkerLayoutMeasurement[] {
  return measurements.map((measurement) => ({
    element_id: measurement.elementId,
    rect: measurement.rect,
    visual_aabb: measurement.visualAabb,
    ...(measurement.contentRect ? { content_rect: measurement.contentRect } : {}),
    ...(measurement.overflowStatus ? { overflow_status: measurement.overflowStatus } : {}),
    measurement_source: "dom",
  }));
}
