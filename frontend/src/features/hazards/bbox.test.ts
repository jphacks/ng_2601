import { describe, expect, it } from "vitest";
import type { BBox } from "../../types/api";
import { bboxContains, bboxIntersects, padBBox } from "./bbox";
import { geometryBBox, representativePoint } from "./geometry";

describe("bbox", () => {
  const box: BBox = [139.76, 35.68, 139.78, 35.69];

  it("包含と交差", () => {
    expect(bboxContains(box, [139.765, 35.682, 139.77, 35.685])).toBe(true);
    expect(bboxContains(box, [139.75, 35.682, 139.77, 35.685])).toBe(false);
    expect(bboxIntersects(box, [139.77, 35.685, 139.8, 35.7])).toBe(true);
    expect(bboxIntersects(box, [139.8, 35.7, 139.9, 35.8])).toBe(false);
  });

  it("padBBox は各辺を広げ、緯度経度の範囲を超えない", () => {
    const padded = padBBox(box, 0.5);
    expect(bboxContains(padded, box)).toBe(true);
    expect(padded[0]).toBeCloseTo(139.75);
    expect(padded[3]).toBeCloseTo(35.695);
    expect(padBBox([-179.9, -89.9, 179.9, 89.9], 1)).toEqual([-180, -90, 180, 90]);
  });
});

describe("geometry", () => {
  it("点・線・面・複合の外接矩形と代表点", () => {
    expect(geometryBBox({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2, 1, 2]);
    expect(
      geometryBBox({
        type: "MultiLineString",
        coordinates: [
          [[0, 0], [2, 1]],
          [[5, 5], [6, 7]],
        ],
      }),
    ).toEqual([0, 0, 6, 7]);
    expect(representativePoint({ type: "LineString", coordinates: [[0, 0], [4, 2]] })).toEqual([2, 1]);
    expect(representativePoint({ type: "Point", coordinates: [3, 4] })).toEqual([3, 4]);
    expect(representativePoint({ type: "GeometryCollection", geometries: [] })).toBeNull();
  });
});
