import type { BBox } from "../../types/api";

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** 各辺を幅・高さの ratio 倍だけ広げる（パン時の再取得を減らす）。緯度経度の範囲内に収める。 */
export function padBBox(box: BBox, ratio: number): BBox {
  const dx = (box[2] - box[0]) * ratio;
  const dy = (box[3] - box[1]) * ratio;
  return [
    Math.max(-180, box[0] - dx),
    Math.max(-90, box[1] - dy),
    Math.min(180, box[2] + dx),
    Math.min(90, box[3] + dy),
  ];
}
