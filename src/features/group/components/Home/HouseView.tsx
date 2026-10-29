/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

// Styles
import { tokens } from "@shared/theme/tokens";
import { globalStyles } from "@shared/theme/globalStyleSheet";

// SDK
import { ESPCDFDevice, ESPCDFGroup, ESPCDFNode } from "@store";

// Hooks
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useCDF } from "@shared/hooks/useCDF";
import { useToast } from "@shared/hooks/useToast";

// Utils
import { extractDeviceType } from "@shared/utils/device";
import { resolveDeviceCardPowerParam } from "@shared/utils/deviceParams";
import { coerceParamValueToBoolean } from "@shared/utils/paramUtils";
import {
  ERROR_CODES,
  ESPRM_NAME_PARAM_TYPE,
} from "@shared/utils/constants";
import { getRoomSubGroups } from "@features/group/utils/roomsHelpers";
import { testProps } from "@shared/utils/testProps";

type HomeDevice = ESPCDFDevice & { node: WeakRef<ESPCDFNode> };

/** Visual family used to pick the glyph and glow colour of a device marker. */
type DeviceKind = "light" | "fan" | "socket" | "ac" | "switch" | "other";

// Types
interface HouseViewProps {
  /** Currently selected home; its room subgroups become the floor plan. */
  home: ESPCDFGroup | null;
  /** Every device of the home (the "All devices" tab list). */
  devices: HomeDevice[];
  /** Opens the room tab when a room label is tapped. */
  onSelectRoom: (roomId: string) => void;
}

/* ----------------------------- Layout constants ---------------------------- */
/** Device slots per row inside a room (kept low so markers stay finger-sized). */
const SLOTS_PER_ROW = 2;
/** Room footprint width in grid units (one unit per slot). */
const ROOM_WIDTH = SLOTS_PER_ROW;
/** Depth reserved in front of the slots for the room label. */
const LABEL_DEPTH = 0.8;
/** Depth behind the first slot row. */
const BACK_MARGIN = 0.6;
const WALL_HEIGHT = 0.7;
const SLAB_HEIGHT = 0.18;
/** Pixels per grid unit before the drawing is scaled to the card width. */
const UNIT = 40;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const UNASSIGNED_ROOM_ID = "__unassigned__";
/** Rooms per row; more makes the plan too wide for a phone. */
const MAX_COLUMNS = 2;

/* --------------------------------- Colours --------------------------------- */
const COLORS = {
  floorOff: "#ece7da",
  floorOn: "#fff2c2",
  wallBack: "#d9d2c1",
  wallSide: "#c9c0ab",
  wallBackOn: "#f3e3a8",
  wallSideOn: "#e6d28e",
  slabFront: "#b8ae97",
  slabSide: "#a59a82",
  outline: "#8a7f68",
  label: "#2f2a1f",
  markerOff: "#ffffff",
  glyphOff: "#8a8a8a",
  offline: "#c7c7c7",
};

const KIND_COLORS: Record<DeviceKind, string> = {
  light: "#f5b700",
  fan: "#2e9bd6",
  socket: "#16650e",
  ac: "#22b8cf",
  switch: "#16650e",
  other: "#16650e",
};

/* --------------------------------- Helpers --------------------------------- */
/** Projects a grid point (x right, y towards the viewer, z up) to screen space. */
const iso = (x: number, y: number, z = 0) => ({
  x: (x - y) * COS30 * UNIT,
  y: (x + y) * SIN30 * UNIT - z * UNIT,
});

const points = (...pts: [number, number, number][]) =>
  pts
    .map(([x, y, z]) => {
      const p = iso(x, y, z);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");

/**
 * Picks the marker family from the device type, falling back to keywords in
 * the device name so plain "switch" channels named "Luz Sala" or "Ventilador"
 * still get a meaningful icon.
 */
const resolveDeviceKind = (type: string | undefined, name: string): DeviceKind => {
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
const resolveDeviceLabel = (device: ESPCDFDevice): string => {
  const nameParam = device.params?.find((p) => p.type === ESPRM_NAME_PARAM_TYPE);
  if (typeof nameParam?.value === "string" && nameParam.value.trim()) {
    return nameParam.value;
  }
  return device.displayName || device.name || "";
};

/** Glyph drawn inside a marker bubble, in a -1..1 box. */
const DeviceGlyph: React.FC<{ kind: DeviceKind; color: string }> = ({
  kind,
  color,
}) => {
  const stroke = { stroke: color, strokeWidth: 0.16, fill: "none" } as const;
  switch (kind) {
    case "light":
      return (
        <G>
          <Circle cx={0} cy={-0.2} r={0.5} fill={color} />
          <Rect x={-0.24} y={0.3} width={0.48} height={0.32} rx={0.06} fill={color} />
        </G>
      );
    case "fan":
      return (
        <G>
          {[0, 120, 240].map((angle) => (
            <Ellipse
              key={angle}
              cx={0}
              cy={-0.42}
              rx={0.2}
              ry={0.42}
              fill={color}
              transform={`rotate(${angle})`}
            />
          ))}
          <Circle cx={0} cy={0} r={0.16} fill="#ffffff" />
        </G>
      );
    case "socket":
      return (
        <G>
          <Rect x={-0.6} y={-0.6} width={1.2} height={1.2} rx={0.3} {...stroke} />
          <Circle cx={-0.22} cy={-0.05} r={0.11} fill={color} />
          <Circle cx={0.22} cy={-0.05} r={0.11} fill={color} />
          <Rect x={-0.08} y={0.22} width={0.16} height={0.16} rx={0.04} fill={color} />
        </G>
      );
    case "ac":
      return (
        <G>
          <Rect x={-0.75} y={-0.55} width={1.5} height={0.6} rx={0.14} fill={color} />
          <Path d="M-0.45 0.25 q0.1 0.2 0 0.4 M0 0.25 q0.1 0.2 0 0.4 M0.45 0.25 q0.1 0.2 0 0.4" {...stroke} />
        </G>
      );
    case "switch":
      return (
        <G>
          <Rect x={-0.45} y={-0.65} width={0.9} height={1.3} rx={0.16} {...stroke} />
          <Rect x={-0.18} y={-0.38} width={0.36} height={0.5} rx={0.08} fill={color} />
        </G>
      );
    default:
      return (
        <G>
          <Path d="M-0.4 -0.38 A0.58 0.58 0 1 0 0.4 -0.38" {...stroke} />
          <Line x1={0} y1={-0.65} x2={0} y2={-0.05} {...stroke} />
        </G>
      );
  }
};

/* -------------------------------- Component -------------------------------- */
/**
 * HouseView
 *
 * Isometric (2.5D) floor plan of the selected home. Rooms are laid out
 * automatically on a grid, each device is a marker that glows while powered,
 * and a room lights up when anything inside it is on.
 * Features:
 * - Tap a device marker to toggle its power
 * - Tap a room name to open that room's tab
 * - Devices without a room are grouped in a "No room" block
 */
const HouseView: React.FC<HouseViewProps> = ({ home, devices, onSelectRoom }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { store } = useCDF();
  const [width, setWidth] = useState(0);

  const rooms = useMemo(
    () => getRoomSubGroups((home?.subGroups as ESPCDFGroup[]) ?? []),
    [home?.subGroups]
  );

  // Group devices per room; anything not in a room goes to a trailing block.
  const roomBlocks = useMemo(() => {
    const assigned = new Set<string>();
    const blocks = rooms.map((room) => {
      const nodeIds = room.nodeIds ?? [];
      nodeIds.forEach((id) => assigned.add(id));
      return {
        id: room.id,
        name: room.name ?? "",
        devices: devices.filter((d) => {
          const node = d.node.deref();
          return node ? nodeIds.includes(node.id) : false;
        }),
      };
    });
    const unassigned = devices.filter((d) => {
      const node = d.node.deref();
      return node ? !assigned.has(node.id) : false;
    });
    if (unassigned.length > 0) {
      blocks.push({
        id: UNASSIGNED_ROOM_ID,
        name: t("group.home.houseView.unassignedRoom"),
        devices: unassigned,
      });
    }
    return blocks;
  }, [rooms, devices, t]);

  // Grid placement: rooms fill rows of `columns`, each row as deep as its deepest room.
  const layout = useMemo(() => {
    const columns = Math.min(MAX_COLUMNS, roomBlocks.length);
    const placed: {
      block: (typeof roomBlocks)[number];
      x0: number;
      y0: number;
      depth: number;
      order: number;
    }[] = [];
    let rowY = 0;
    for (let start = 0; start < roomBlocks.length; start += columns) {
      const row = roomBlocks.slice(start, start + columns);
      const rowDepth = Math.max(
        ...row.map(
          (b) =>
            BACK_MARGIN +
            Math.max(1, Math.ceil(b.devices.length / SLOTS_PER_ROW)) +
            LABEL_DEPTH - 0.4
        )
      );
      row.forEach((block, col) => {
        placed.push({
          block,
          x0: col * ROOM_WIDTH,
          y0: rowY,
          depth: rowDepth,
          order: col + start / columns,
        });
      });
      rowY += rowDepth;
    }
    // Back-to-front paint order.
    placed.sort((a, b) => a.order - b.order);

    // Bounding box of everything drawn, including walls and the slab.
    const xs: number[] = [];
    const ys: number[] = [];
    placed.forEach(({ x0, y0, depth }) => {
      [
        iso(x0, y0, WALL_HEIGHT),
        iso(x0 + ROOM_WIDTH, y0, WALL_HEIGHT),
        iso(x0, y0 + depth, WALL_HEIGHT),
        iso(x0 + ROOM_WIDTH, y0 + depth, -SLAB_HEIGHT),
        iso(x0, y0 + depth, -SLAB_HEIGHT),
        iso(x0 + ROOM_WIDTH, y0, -SLAB_HEIGHT),
      ].forEach((p) => {
        xs.push(p.x);
        ys.push(p.y);
      });
    });
    const pad = UNIT * 0.4;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad - UNIT * 1.3; // headroom for raised markers
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return { placed, viewBox: { minX, minY, w: maxX - minX, h: maxY - minY } };
  }, [roomBlocks]);

  if (roomBlocks.length === 0) {
    return null;
  }

  /** Re-reads the device from the store so MobX updates re-render this view. */
  const resolveLive = (device: HomeDevice) => {
    const node = device.node.deref();
    const storeNode = node ? store.nodeStore.nodesByIDMap[node.id] ?? node : undefined;
    const storeDevice =
      storeNode?.devices?.find((d) => d.name === device.name) ?? device;
    const powerParam = resolveDeviceCardPowerParam(storeDevice);
    const isOnline = storeNode?.connectivityStatus?.isConnected ?? false;
    const isOn = coerceParamValueToBoolean(powerParam?.value);
    return { storeDevice, powerParam, isOnline, isOn };
  };

  const handleToggle = (device: HomeDevice) => {
    const { powerParam, isOnline, isOn } = resolveLive(device);
    if (!powerParam) return;
    if (!isOnline) {
      toast.showError(t("layout.shared.offline"));
      return;
    }
    powerParam.setValue(!isOn).catch((err: { code?: string }) => {
      const key = err?.code && ERROR_CODES[err.code as keyof typeof ERROR_CODES];
      toast.showError(key ? t(key) : t("group.errors.fallback"));
    });
  };

  let devicesOn = 0;
  let devicesWithPower = 0;

  const rooms3d = layout.placed.map(({ block, x0, y0, depth }) => {
    const x1 = x0 + ROOM_WIDTH;
    const y1 = y0 + depth;
    const live = block.devices.map((d) => ({ device: d, ...resolveLive(d) }));
    const roomOn = live.some((d) => d.powerParam && d.isOn);
    live.forEach((d) => {
      if (d.powerParam) {
        devicesWithPower += 1;
        if (d.isOn) devicesOn += 1;
      }
    });
    return { block, x0, y0, x1, y1, live, roomOn };
  });

  const { viewBox } = layout;
  const height = width > 0 ? (width * viewBox.h) / viewBox.w : 0;

  return (
    <View
      style={styles.card}
      {...testProps("view_house_3d")}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width - tokens.spacing._15 * 2)}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t("group.home.houseView.title")}</Text>
        <Text style={styles.summary}>
          {t("group.home.houseView.summary", {
            on: devicesOn,
            total: devicesWithPower,
          })}
        </Text>
      </View>

      {width > 0 && (
        <Svg
          width={width}
          height={height}
          viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.w} ${viewBox.h}`}
        >
          <Defs>
            {(Object.keys(KIND_COLORS) as DeviceKind[]).map((kind) => (
              <RadialGradient key={kind} id={`glow-${kind}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={KIND_COLORS[kind]} stopOpacity={0.75} />
                <Stop offset="100%" stopColor={KIND_COLORS[kind]} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>

          {/* Rooms: slab, floor and the two back walls (dollhouse cut-away). */}
          {rooms3d.map(({ block, x0, y0, x1, y1, roomOn }) => (
            <G key={`room-${block.id}`}>
              <Polygon
                points={points([x0, y1, 0], [x1, y1, 0], [x1, y1, -SLAB_HEIGHT], [x0, y1, -SLAB_HEIGHT])}
                fill={COLORS.slabFront}
              />
              <Polygon
                points={points([x1, y0, 0], [x1, y1, 0], [x1, y1, -SLAB_HEIGHT], [x1, y0, -SLAB_HEIGHT])}
                fill={COLORS.slabSide}
              />
              <Polygon
                points={points([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0])}
                fill={roomOn ? COLORS.floorOn : COLORS.floorOff}
                stroke={COLORS.outline}
                strokeWidth={0.6}
              />
              <Polygon
                points={points([x0, y0, 0], [x1, y0, 0], [x1, y0, WALL_HEIGHT], [x0, y0, WALL_HEIGHT])}
                fill={roomOn ? COLORS.wallBackOn : COLORS.wallBack}
                stroke={COLORS.outline}
                strokeWidth={0.6}
              />
              <Polygon
                points={points([x0, y0, 0], [x0, y1, 0], [x0, y1, WALL_HEIGHT], [x0, y0, WALL_HEIGHT])}
                fill={roomOn ? COLORS.wallSideOn : COLORS.wallSide}
                stroke={COLORS.outline}
                strokeWidth={0.6}
              />
            </G>
          ))}

          {/* Device markers, always on top so none is hidden behind a wall. */}
          {rooms3d.map(({ block, x0, y0, live }) =>
            live.map(({ device, storeDevice, powerParam, isOnline, isOn }, index) => {
              const col = index % SLOTS_PER_ROW;
              const row = Math.floor(index / SLOTS_PER_ROW);
              const floor = iso(x0 + 0.5 + col, y0 + BACK_MARGIN + 0.4 + row);
              const label = resolveDeviceLabel(storeDevice);
              const kind = resolveDeviceKind(storeDevice.type, label);
              const active = Boolean(powerParam) && isOn && isOnline;
              const accent = isOnline ? KIND_COLORS[kind] : COLORS.offline;
              const bubbleY = floor.y - UNIT * 0.8;
              const r = UNIT * 0.42;
              return (
                <G
                  key={`dev-${block.id}-${device.node.deref()?.id}-${device.name}`}
                  onPress={() => handleToggle(device)}
                >
                  {active && (
                    <Ellipse
                      cx={floor.x}
                      cy={floor.y}
                      rx={UNIT * 0.8}
                      ry={UNIT * 0.46}
                      fill={`url(#glow-${kind})`}
                    />
                  )}
                  <Ellipse
                    cx={floor.x}
                    cy={floor.y}
                    rx={UNIT * 0.16}
                    ry={UNIT * 0.09}
                    fill="rgba(0,0,0,0.18)"
                  />
                  <Line
                    x1={floor.x}
                    y1={floor.y}
                    x2={floor.x}
                    y2={bubbleY + r}
                    stroke={active ? accent : COLORS.outline}
                    strokeWidth={1.4}
                  />
                  <Circle
                    cx={floor.x}
                    cy={bubbleY}
                    r={r}
                    fill={active ? accent : COLORS.markerOff}
                    stroke={accent}
                    strokeWidth={1.6}
                  />
                  <G transform={`translate(${floor.x} ${bubbleY}) scale(${r * 0.62})`}>
                    <DeviceGlyph
                      kind={kind}
                      color={active ? "#ffffff" : isOnline ? accent : COLORS.glyphOff}
                    />
                  </G>
                </G>
              );
            })
          )}
          {/* Room names last, on a pill, so markers of the room in front never hide them. */}
          {rooms3d.map(({ block, x0, x1, y1 }) => {
            const p = iso((x0 + x1) / 2, y1 - 0.3);
            const fontSize = UNIT * 0.36;
            const pillW = Math.max(UNIT, block.name.length * fontSize * 0.62 + UNIT * 0.4);
            const pillH = fontSize * 1.5;
            const onPress =
              block.id === UNASSIGNED_ROOM_ID
                ? undefined
                : () => onSelectRoom(block.id);
            return (
              <G key={`label-${block.id}`} onPress={onPress}>
                <Rect
                  x={p.x - pillW / 2}
                  y={p.y - pillH * 0.72}
                  width={pillW}
                  height={pillH}
                  rx={pillH / 2}
                  fill="rgba(255,255,255,0.92)"
                  stroke={COLORS.outline}
                  strokeWidth={0.5}
                />
                <SvgText
                  x={p.x}
                  y={p.y}
                  fontSize={fontSize}
                  fontWeight="bold"
                  fill={COLORS.label}
                  textAnchor="middle"
                >
                  {block.name}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}

      <Text style={styles.hint}>{t("group.home.houseView.hint")}</Text>
    </View>
  );
};

/* ------------------------------ Styles ------------------------------- */
const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    marginTop: tokens.spacing._15,
    paddingVertical: tokens.spacing._15,
    paddingHorizontal: tokens.spacing._15,
    backgroundColor: tokens.colors.bannerBg,
    ...globalStyles.shadowElevationForLightTheme,
    borderRadius: tokens.radius.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.spacing._10,
  },
  title: {
    fontFamily: tokens.fonts.medium,
    fontWeight: "bold",
    fontSize: tokens.fontSize.md,
    color: tokens.colors.primary,
  },
  summary: {
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.text_secondary,
  },
  hint: {
    marginTop: tokens.spacing._10,
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSize.xs,
    color: tokens.colors.text_secondary,
    textAlign: "center",
  },
});

export default observer(HouseView);
