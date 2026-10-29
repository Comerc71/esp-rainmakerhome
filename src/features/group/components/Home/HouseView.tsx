/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  PanResponder,
  StyleSheet,
} from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { ImagePlus, Pencil, Check, Trash2 } from "lucide-react-native";

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
import { resolveDeviceCardPowerParam } from "@shared/utils/deviceParams";
import { coerceParamValueToBoolean } from "@shared/utils/paramUtils";
import { ERROR_CODES } from "@shared/utils/constants";
import { testProps } from "@shared/utils/testProps";
import {
  DEVICE_KIND_COLORS,
  DeviceKind,
  EMPTY_HOUSE_LAYOUT,
  HouseViewLayout,
  MarkerPosition,
  clamp01,
  deleteHouseImage,
  getDefaultMarkerPosition,
  getMarkerKey,
  loadHouseLayout,
  persistHouseImage,
  resolveDeviceKind,
  resolveDeviceLabel,
  saveHouseLayout,
} from "@features/group/utils/houseView";

type HomeDevice = ESPCDFDevice & { node: WeakRef<ESPCDFNode> };

// Types
interface HouseViewProps {
  /** Currently selected home; the layout is saved per home. */
  home: ESPCDFGroup | null;
  /** Every device of the home (the "All devices" tab list). */
  devices: HomeDevice[];
}

const MARKER_SIZE = 34;
const GLOW_SIZE = 64;
/** Tallest the image may get, relative to its width (very tall plans scroll badly). */
const MAX_IMAGE_ASPECT = 1.4;
const OFFLINE_COLOR = "#c7c7c7";
const GLYPH_OFF_COLOR = "#8a8a8a";

/** Glyph drawn inside a marker, in a -1..1 box. */
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

interface DeviceMarkerProps {
  label: string;
  kind: DeviceKind;
  isOn: boolean;
  isOnline: boolean;
  editing: boolean;
  /** Marker centre in pixels inside the image. */
  left: number;
  top: number;
  onToggle: () => void;
  /** Called with the drag offset in pixels when a drag ends. */
  onDrop: (dx: number, dy: number) => void;
}

/**
 * One device icon on the house image. Tapping toggles power; in edit mode it
 * follows the finger and reports where it was dropped.
 */
const DeviceMarker: React.FC<DeviceMarkerProps> = ({
  label,
  kind,
  isOn,
  isOnline,
  editing,
  left,
  top,
  onToggle,
  onDrop,
}) => {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onMoveShouldSetPanResponder: () => editing,
        // Keep the list from stealing the gesture mid-drag.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setDrag({ dx: 0, dy: 0 }),
        onPanResponderMove: (_, g) => setDrag({ dx: g.dx, dy: g.dy }),
        onPanResponderRelease: (_, g) => {
          setDrag(null);
          onDrop(g.dx, g.dy);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    [editing, onDrop]
  );

  const active = isOn && isOnline;
  const accent = isOnline ? DEVICE_KIND_COLORS[kind] : OFFLINE_COLOR;
  const x = left + (drag?.dx ?? 0);
  const y = top + (drag?.dy ?? 0);

  const markerStyle = [
    styles.marker,
    {
      backgroundColor: active ? accent : "#ffffff",
      borderColor: editing ? tokens.colors.primary : accent,
      borderStyle: editing ? ("dashed" as const) : ("solid" as const),
    },
  ];
  const glyph = (
    <Svg width={MARKER_SIZE * 0.62} height={MARKER_SIZE * 0.62} viewBox="-1 -1 2 2">
      <DeviceGlyph
        kind={kind}
        color={active ? "#ffffff" : isOnline ? accent : GLYPH_OFF_COLOR}
      />
    </Svg>
  );

  return (
    <View
      style={[
        styles.markerWrap,
        { left: x - GLOW_SIZE / 2, top: y - GLOW_SIZE / 2 },
        drag && styles.markerDragging,
      ]}
      pointerEvents="box-none"
    >
      {active && (
        <View
          style={[styles.glow, { backgroundColor: accent }]}
          pointerEvents="none"
        />
      )}
      {editing ? (
        <View
          {...responder.panHandlers}
          {...testProps("view_house_device_drag")}
          hitSlop={8}
          style={markerStyle}
        >
          {glyph}
        </View>
      ) : (
        <Pressable
          {...testProps("button_house_device")}
          onPress={onToggle}
          hitSlop={8}
          accessibilityLabel={label}
          style={markerStyle}
        >
          {glyph}
        </Pressable>
      )}
      {editing && (
        <Text style={styles.markerLabel} numberOfLines={1} pointerEvents="none">
          {label}
        </Text>
      )}
    </View>
  );
};

/**
 * HouseView
 *
 * The user's own picture of the house (a 3D render or floor plan picked from
 * the gallery) with every device as an icon on top of it.
 * Features:
 * - Tap a device icon to toggle its power; powered devices glow
 * - Edit mode: drag icons into place, change or remove the image
 * - Image and positions are saved per home on this phone
 */
const HouseView: React.FC<HouseViewProps> = ({ home, devices }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { store } = useCDF();
  const homeId = home?.id ?? "";

  const [layout, setLayout] = useState<HouseViewLayout>(EMPTY_HOUSE_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEditing(false);
    setImageFailed(false);
    if (!homeId) {
      setLayout(EMPTY_HOUSE_LAYOUT);
      return;
    }
    loadHouseLayout(homeId).then((saved) => {
      if (!cancelled) setLayout(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [homeId]);

  const updateLayout = useCallback(
    (next: HouseViewLayout) => {
      setLayout(next);
      if (homeId) saveHouseLayout(homeId, next);
    },
    [homeId]
  );

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.showError(t("chat.imagePermissionDenied"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        exif: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const uri = persistHouseImage(homeId, asset.uri);
      deleteHouseImage(layout.imageUri);
      setImageFailed(false);
      updateLayout({
        ...layout,
        imageUri: uri,
        imageWidth: asset.width,
        imageHeight: asset.height,
      });
      setEditing(true);
    } catch (error) {
      console.error("[HouseView] Failed to pick image:", error);
      toast.showError(t("group.home.houseView.imagePickFailed"));
    }
  };

  const handleRemoveImage = () => {
    deleteHouseImage(layout.imageUri);
    updateLayout({ ...EMPTY_HOUSE_LAYOUT, positions: layout.positions });
    setEditing(false);
  };

  /** Re-reads the device from the store so MobX updates re-render this view. */
  const resolveLive = (device: HomeDevice) => {
    const node = device.node.deref();
    const storeNode = node
      ? store.nodeStore.nodesByIDMap[node.id] ?? node
      : undefined;
    const storeDevice =
      storeNode?.devices?.find((d) => d.name === device.name) ?? device;
    const powerParam = resolveDeviceCardPowerParam(storeDevice);
    return {
      nodeId: storeNode?.id ?? "",
      storeDevice,
      powerParam,
      isOnline: storeNode?.connectivityStatus?.isConnected ?? false,
      isOn: coerceParamValueToBoolean(powerParam?.value),
    };
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

  const hasImage = Boolean(layout.imageUri) && !imageFailed;
  const aspect =
    layout.imageWidth > 0
      ? Math.min(MAX_IMAGE_ASPECT, layout.imageHeight / layout.imageWidth)
      : 0.6;
  const imageHeight = width * aspect;

  const live = devices.map((device) => ({ device, ...resolveLive(device) }));
  const withPower = live.filter((d) => d.powerParam);
  const devicesOn = withPower.filter((d) => d.isOn).length;

  return (
    <View style={styles.card} {...testProps("view_house_3d")}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("group.home.houseView.title")}</Text>
          <Text style={styles.summary}>
            {t("group.home.houseView.summary", {
              on: devicesOn,
              total: withPower.length,
            })}
          </Text>
        </View>
        {hasImage && (
          <Pressable
            {...testProps("button_house_edit")}
            style={styles.actionButton}
            onPress={() => setEditing((value) => !value)}
            hitSlop={8}
          >
            {editing ? (
              <Check size={18} color={tokens.colors.primary} />
            ) : (
              <Pencil size={18} color={tokens.colors.primary} />
            )}
            <Text style={styles.actionText}>
              {editing
                ? t("group.home.houseView.done")
                : t("group.home.houseView.edit")}
            </Text>
          </Pressable>
        )}
      </View>

      {!hasImage ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {t("group.home.houseView.emptyTitle")}
          </Text>
          <Text style={styles.emptyDescription}>
            {t("group.home.houseView.emptyDescription")}
          </Text>
          <Pressable
            {...testProps("button_house_pick_image")}
            style={styles.primaryButton}
            onPress={handlePickImage}
            disabled={!homeId}
          >
            <ImagePlus size={18} color="#ffffff" />
            <Text style={styles.primaryButtonText}>
              {t("group.home.houseView.chooseImage")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View
            style={[styles.imageWrap, { height: imageHeight || undefined }]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          >
            <Image
              source={{ uri: layout.imageUri as string }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
            {width > 0 &&
              live.map((entry, index) => {
                const key = getMarkerKey(entry.nodeId, entry.device.name);
                const pos: MarkerPosition =
                  layout.positions[key] ?? getDefaultMarkerPosition(index);
                const label = resolveDeviceLabel(entry.storeDevice);
                return (
                  <DeviceMarker
                    key={key}
                    label={label}
                    kind={resolveDeviceKind(entry.storeDevice.type, label)}
                    isOn={Boolean(entry.powerParam) && entry.isOn}
                    isOnline={entry.isOnline}
                    editing={editing}
                    left={pos.x * width}
                    top={pos.y * imageHeight}
                    onToggle={() => handleToggle(entry.device)}
                    onDrop={(dx, dy) =>
                      updateLayout({
                        ...layout,
                        positions: {
                          ...layout.positions,
                          [key]: {
                            x: clamp01(pos.x + dx / width),
                            y: clamp01(pos.y + dy / imageHeight),
                          },
                        },
                      })
                    }
                  />
                );
              })}
          </View>

          {editing ? (
            <>
              <Text style={styles.hint}>{t("group.home.houseView.editHint")}</Text>
              <View style={styles.editActions}>
                <Pressable style={styles.secondaryButton} onPress={handlePickImage}>
                  <ImagePlus size={16} color={tokens.colors.primary} />
                  <Text style={styles.actionText}>
                    {t("group.home.houseView.changeImage")}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={handleRemoveImage}>
                  <Trash2 size={16} color={tokens.colors.red} />
                  <Text style={[styles.actionText, { color: tokens.colors.red }]}>
                    {t("group.home.houseView.removeImage")}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.hint}>{t("group.home.houseView.hint")}</Text>
          )}
        </>
      )}
    </View>
  );
};

/* ------------------------------ Styles ------------------------------- */
const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    marginTop: tokens.spacing._15,
    padding: tokens.spacing._15,
    backgroundColor: tokens.colors.bannerBg,
    ...globalStyles.shadowElevationForLightTheme,
    borderRadius: tokens.radius.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
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
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing._5,
    paddingVertical: tokens.spacing._5,
    paddingHorizontal: tokens.spacing._10,
  },
  actionText: {
    fontFamily: tokens.fonts.medium,
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.primary,
  },
  imageWrap: {
    width: "100%",
    borderRadius: tokens.radius.sm,
    overflow: "hidden",
    backgroundColor: "#1f2a33",
  },
  markerWrap: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  markerDragging: {
    transform: [{ scale: 1.15 }],
    zIndex: 10,
  },
  glow: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    opacity: 0.35,
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  markerLabel: {
    position: "absolute",
    top: GLOW_SIZE / 2 + MARKER_SIZE / 2,
    maxWidth: 110,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.92)",
    fontFamily: tokens.fonts.medium,
    fontSize: tokens.fontSize.xxs,
    color: "#2f2a1f",
  },
  hint: {
    marginTop: tokens.spacing._10,
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSize.xs,
    color: tokens.colors.text_secondary,
    textAlign: "center",
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: tokens.spacing._10,
    marginTop: tokens.spacing._10,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing._5,
    paddingVertical: tokens.spacing._5,
    paddingHorizontal: tokens.spacing._10,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.colors.borderColor,
    backgroundColor: "#ffffff",
  },
  empty: {
    alignItems: "center",
    paddingVertical: tokens.spacing._15,
  },
  emptyTitle: {
    fontFamily: tokens.fonts.medium,
    fontWeight: "bold",
    fontSize: tokens.fontSize.md,
    color: tokens.colors.text_primary_dark,
    textAlign: "center",
  },
  emptyDescription: {
    marginTop: tokens.spacing._5,
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.text_secondary,
    textAlign: "center",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing._5,
    marginTop: tokens.spacing._15,
    paddingVertical: tokens.spacing._10,
    paddingHorizontal: tokens.spacing._20,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.primary,
  },
  primaryButtonText: {
    fontFamily: tokens.fonts.medium,
    fontSize: tokens.fontSize.sm,
    color: "#ffffff",
  },
});

export default observer(HouseView);
