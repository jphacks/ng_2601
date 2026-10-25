import type { BikeType } from "../../types/api";
import city from "./icons/mdi-bicycle.svg?raw";
import electricAssist from "./icons/mdi-bicycle-electric.svg?raw";
import road from "./icons/mdi-bike-fast.svg?raw";
import gravel from "./icons/iconoven-mountain-bike.svg?raw";
import mamachari from "./icons/mdi-bicycle-basket.svg?raw";

/** 車種ボタンに出す SVG 文字列。出典は icons/README.md。 */
export const BIKE_TYPE_ICONS: Record<BikeType, string> = {
  city,
  electric_assist: electricAssist,
  road,
  gravel,
  mamachari,
};
