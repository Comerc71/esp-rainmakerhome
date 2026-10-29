/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";

// Styles
import { tokens } from "@shared/theme/tokens";
import { globalStyles } from "@shared/theme/globalStyleSheet";

// Icons
import { ArrowUpRight } from "lucide-react-native";

// SDK
import { ESPCDFGroup } from "@store";

// Hooks
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { testProps } from "@shared/utils/testProps";

// Types
interface BannerProps {
  /** Image source for the banner */
  image: any;
  /** Currently active group */
  activeGroup: ESPCDFGroup | null;
  /** Callback when the dropdown button is pressed */
  onDropdownPress: (position: { x: number; y: number }) => void;
  /**
   * When true (or when the home name is not yet available), the dropdown
   * row shows a compact skeleton instead of the home name.
   */
  isHomeNameLoading?: boolean;
}

/**
 * Banner
 *
 * A banner component that displays the current home/group selection
 * with a dropdown to switch between available groups.
 * Features:
 * - Yassena artwork with welcome caption
 * - Arrow button opening the home switcher
 */
const Banner: React.FC<BannerProps> = ({
  image,
  activeGroup,
  onDropdownPress,
  isHomeNameLoading = false,
}) => {
  const { t } = useTranslation();
  const buttonRef = React.useRef<View>(null);
  const showHomeNameSkeleton =
    isHomeNameLoading || !(activeGroup?.name && activeGroup.name.length > 0);

  const handlePress = () => {
    if (showHomeNameSkeleton) {
      return;
    }
    if (buttonRef.current) {
      buttonRef.current.measure(
        (
          _x: number,
          _y: number,
          _width: number,
          height: number,
          pageX: number,
          pageY: number
        ) => {
          // Use pageX and pageY for true screen coordinates
          onDropdownPress({ x: pageX, y: pageY + height + 5 });
        }
      );
    }
  };

  return (
    <View style={styles.banner} {...testProps("view_home_banner")}>
      <Image
        {...testProps("image_home_banner")}
        source={image}
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.captionRow}>
        <Text
          {...testProps("text_title_home_banner")}
          style={styles.caption}
        >
          {t("group.home.homeBannerWelcome")}
        </Text>
        {/* The arrow opens the home switcher (the home name is no longer shown) */}
        <TouchableOpacity
          ref={buttonRef}
          {...testProps("button_dropdown_home_banner")}
          style={styles.arrowButton}
          onPress={handlePress}
          disabled={showHomeNameSkeleton}
          hitSlop={10}
          accessibilityLabel={activeGroup?.name}
        >
          <ArrowUpRight
            color={
              showHomeNameSkeleton
                ? tokens.colors.gray
                : tokens.colors.text_primary_dark
            }
            size={24}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

/* ------------------------------ Styles ------------------------------- */
const BANNER_ART_ASPECT = 1462 / 817;

const styles = StyleSheet.create({
  banner: {
    alignSelf: "stretch",
    backgroundColor: tokens.colors.bannerBg,
    ...globalStyles.shadowElevationForLightTheme,
    borderRadius: tokens.radius.md,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    aspectRatio: BANNER_ART_ASPECT,
  },
  // Overlaid on the empty lower-right area of the artwork
  captionRow: {
    position: "absolute",
    right: tokens.spacing._15,
    bottom: tokens.spacing._15,
    width: "55%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  caption: {
    flexShrink: 1,
    textAlign: "right",
    fontFamily: tokens.fonts.regular,
    fontSize: tokens.fontSize.sm,
    color: tokens.colors.text_primary_dark,
  },
  arrowButton: {
    marginLeft: tokens.spacing._10,
  },
});

export default observer(Banner);
