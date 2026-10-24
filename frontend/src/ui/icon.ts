const SVG_NS = "http://www.w3.org/2000/svg";

/** 24x24 viewBox, stroke-only paths drawn for this project (no external icon set). */
const PATHS = {
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  layers: ["M12 3l9 5-9 5-9-5 9-5z", "M3 13l9 5 9-5"],
  compass: ["M12 3l5 17-5-4-5 4 5-17z"],
  locate: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  pin: ["M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z", "M12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"],
  shield: ["M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z", "M9 12l2 2 4-4"],
  chart: ["M4 20h16", "M7 16v-4", "M12 16V8", "M17 16V5"],
  ban: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M5.6 5.6l12.8 12.8"],
  warning: ["M12 3l10 18H2L12 3z", "M12 10v4", "M12 17.5v.01"],
  person: ["M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 21c0-4 4-6 8-6s8 2 8 6"],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
