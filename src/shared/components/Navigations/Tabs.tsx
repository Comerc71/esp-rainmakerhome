/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";

// Styles
import { tokens } from "@shared/theme/tokens";
import { testProps } from "@shared/utils/testProps";

// Types
interface Tab {
  /** Display label for the tab */
  label: string;
  /** Unique identifier for the tab */
  id: string;
}

interface TabsProps {
  /** Array of tab items */
  tabs: Tab[];
  /** Currently selected tab */
  activeTab: Tab | null;
  /** Callback when a tab is selected */
  onSelectTab: (tab: Tab) => void;
}

/**
 * Tabs
 *
 * A horizontal scrollable tab navigation component.
 * Features:
 * - Horizontal scrolling
 * - Active tab indication
 * - Text truncation
 * - Touch interaction
 */
const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onSelectTab }) => (
  <View {...testProps("view_room_tabs")} style={styles.tabs}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {tabs.map((tab) => (
        <TouchableOpacity
          {...testProps(`button_room_tab_${tab.label}`)}
          style={styles.tabContainer}
          key={tab.id}
          onPress={() => onSelectTab(tab)}
        >
          <Text
            {...testProps(`text_room_tab_${tab.label}`)}
            style={[styles.tab, activeTab?.id === tab.id && styles.activeTab]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {tab.label}
          </Text>
          {activeTab?.id === tab.id && <View style={styles.activeIndicator} />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
);

/* ------------------------------ Styles ------------------------------- */
const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: tokens.spacing._10,
    backgroundColor: "transparent",
  },
  tabContainer: {
    marginRight: tokens.spacing._15,
    alignItems: "center",
    paddingVertical: tokens.spacing._5,
    paddingHorizontal: tokens.spacing._10,
    borderRadius: tokens.radius.sm,
  },
  // Tabs sit on the green home background
  tab: {
    color: "rgba(255, 255, 255, 0.7)",
    fontFamily: tokens.fonts.medium,
    fontSize: tokens.fontSize.md,
    fontWeight: "600",
    height: tokens.spacing._20,
    lineHeight: tokens.spacing._20,
    maxWidth: 160,
    overflow: "hidden",
    textAlign: "left",
    width: "auto",
    paddingHorizontal: tokens.spacing._5,
  },
  activeTab: {
    color: "#ffffff",
    fontWeight: "700",
  },
  activeIndicator: {
    height: 3,
    width: "100%",
    backgroundColor: "#ffffff",
    marginTop: tokens.spacing._5,
    borderRadius: 2,
  },
});

export default Tabs;
