/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";

import { ESPCDFDevice } from "@store";
import { extractDeviceType } from "@shared/utils/device";
import { ESPRM_NAME_PARAM_TYPE } from "@shared/utils/constants";

/** Visual family used to pick the glyph and glow colour of a device marker. */
export type DeviceKind = "light" | "fan" | "socket" | "ac" | "switch" | "other";

export const DEVICE_KIND_COLORS: Record<DeviceKind, string> = {
  light: "#f5b700",
  fan: "#2e9bd6",
  socket: "#16650e",
  ac: "#22b8cf",
  switch: "#16650e",
  other: "#16650e",
};

/** Marker position as a fraction (0..1) of the house image width/height. */
export interface MarkerPosition {
  x: number;
  y: number;
}

/** Per-home house view settings, kept on this phone only. */
export interface HouseViewLayout {
  imageUri: string | null;
  imageWidth: number;
  imageHeight: number;
  positions: Record<string, MarkerPosition>;
}

export const EMPTY_HOUSE_LAYOUT: HouseViewLayout = {
  imageUri: null,
  imageWidth: 0,
  imageHeight: 0,
  positions: {},
};

const STORAGE_KEY_PREFIX = "@yassena/houseView/";
const IMAGE_FILE_PREFIX = "yassena-house-";

/**
 * Picks the marker family from the device type, falling back to keywords in
 * the device name so plain "switch" channels named "Luz Sala" or "Ventilador"
 * still get a meaningful icon.
 */
export const resolveDeviceKind = (
  type: string | undefined,
  name: string
): DeviceKind => {
  const t = extractDeviceType(type).toLowerCase();
  const n = name.toLowerCase();
  if (/light|bulb|lamp/.test(t) || /\b(luz|luzes|l[âa]mpada|lumin|abajur|spot)/.test(n)) {
    return "light";
  }
  if (/fan/.test(t) || /ventilador|exaust/.test(n)) return "fan";
  if (/air|thermostat|\bac\b/.test(t) || /\bar\b|ar[- ]condicionado|climatizador|split/.test(n)) {
    return "ac";
  }
  if (/outlet|socket|plug/.test(t) || /tomada/.test(n)) return "socket";
  if (/switch/.test(t)) return "switch";
  return "other";
};

/** Live display name: name param beats displayName beats the raw device name. */
export const resolveDeviceLabel = (device: ESPCDFDevice): string => {
  const nameParam = device.params?.find((p) => p.type === ESPRM_NAME_PARAM_TYPE);
  if (typeof nameParam?.value === "string" && nameParam.value.trim()) {
    return nameParam.value;
  }
  return device.displayName || device.name || "";
};

/** Stable key for a device marker: node id plus device name. */
export const getMarkerKey = (nodeId: string, deviceName: string): string =>
  `${nodeId}:${deviceName}`;

/**
 * Starting spot for a device that was never dragged: a grid along the top of
 * the image, so new devices are easy to find and move.
 */
export const getDefaultMarkerPosition = (
  index: number,
  perRow = 6
): MarkerPosition => ({
  x: ((index % perRow) + 0.5) / perRow,
  y: 0.1 + Math.floor(index / perRow) * 0.16,
});

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

/** Reads the saved layout for a home, or an empty one. */
export const loadHouseLayout = async (
  homeId: string
): Promise<HouseViewLayout> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + homeId);
    if (!raw) return EMPTY_HOUSE_LAYOUT;
    return { ...EMPTY_HOUSE_LAYOUT, ...JSON.parse(raw) };
  } catch (error) {
    console.warn("[houseView] Failed to load layout", error);
    return EMPTY_HOUSE_LAYOUT;
  }
};

export const saveHouseLayout = async (
  homeId: string,
  layout: HouseViewLayout
): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_PREFIX + homeId, JSON.stringify(layout));
  } catch (error) {
    console.warn("[houseView] Failed to save layout", error);
  }
};

/**
 * Copies a picked image into the app's documents folder so it survives the
 * picker cache being cleared. Returns the new file URI.
 */
export const persistHouseImage = (homeId: string, sourceUri: string): string => {
  const extension = sourceUri.split("?")[0].split(".").pop() || "jpg";
  const safeHomeId = homeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const target = new File(
    Paths.document,
    `${IMAGE_FILE_PREFIX}${safeHomeId}-${Date.now()}.${extension}`
  );
  new File(sourceUri).copy(target);
  return target.uri;
};

/** Deletes a previously persisted house image; missing files are ignored. */
export const deleteHouseImage = (uri: string | null): void => {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn("[houseView] Failed to delete image", error);
  }
};
