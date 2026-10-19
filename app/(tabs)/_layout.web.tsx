import { Redirect, Tabs, usePathname } from "expo-router";
import { Image, StyleSheet, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "../../context/alerts";
import { useAuth } from "../../context/auth";
import { useT } from "../../lib/i18n";
import AlertToast from "../../components/alerts/AlertToast";
import { C, F } from "../../components/ui/theme";

const TAB_ICONS = {
  home: require("../../assets/Icons/house.png"),
  heatmap: require("../../assets/Icons/location.png"),
  alerts: require("../../assets/Icons/bell.png"),
  family: require("../../assets/Icons/family.png"),
  profile: require("../../assets/Icons/user.png"),
};

function TabBarIcon({ name, color, focused }: { name: keyof typeof TAB_ICONS; color: ColorValue; focused: boolean }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapOn]}>
      <Image source={TAB_ICONS[name]} tintColor={color} style={styles.tabIcon} resizeMode="contain" />
    </View>
  );
}

const icon = (name: keyof typeof TAB_ICONS) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <TabBarIcon name={name} color={color} focused={focused} />;
  };

const ICONS = {
  home: icon("home"),
  heatmap: icon("heatmap"),
  alerts: icon("alerts"),
  family: icon("family"),
  profile: icon("profile"),
};

// Web only: puts the tab bar at the bottom. iPhone/Android use _layout.tsx (native tabs).
export default function WebTabsLayout() {
  const { unread } = useAlerts();
  const { user, loading, isGuest } = useAuth();
  const pathname = usePathname();
  const t = useT();
  const insets = useSafeAreaInsets();

  if (!loading && !user && !isGuest) return <Redirect href="/login" />;
  // Guests may only use Home: no tab bar, and other tabs send them back.
  const guest = isGuest && !user;
  if (guest && pathname !== "/home") return <Redirect href="/home" />;
  const memberOnly = guest ? { href: null } : {};

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: C.brand,
          tabBarInactiveTintColor: "#6F6359",
          // Room for icon + label, plus the phone's home-indicator inset.
          tabBarStyle: {
            display: guest ? "none" : "flex",
            backgroundColor: "#FFFDF9",
            borderTopColor: "rgba(43,35,32,0.08)",
            borderTopWidth: 1,
            height: 70 + insets.bottom,
            paddingTop: 8,
            paddingBottom: 10 + insets.bottom,
          },
          // No default item padding, so the icon and the label both get their full height.
          tabBarItemStyle: { paddingVertical: 0 },
          tabBarLabelStyle: { fontSize: 11, fontFamily: F.bodyMedium, marginTop: 3, lineHeight: 14, flexShrink: 0 },
          tabBarBadgeStyle: { backgroundColor: C.high, color: "#FFFFFF", fontSize: 10, fontFamily: F.bodySemi },
        }}
      >
        <Tabs.Screen name="home" options={{ title: t("Home"), tabBarIcon: ICONS.home }} />
        <Tabs.Screen name="heatmap" options={{ title: t("Heat map"), tabBarIcon: ICONS.heatmap, ...memberOnly }} />
        <Tabs.Screen
          name="alerts"
          options={{
            title: t("Alerts"),
            tabBarBadge: unread > 0 ? unread : undefined,
            tabBarIcon: ICONS.alerts,
            ...memberOnly,
          }}
        />
        <Tabs.Screen name="family" options={{ title: t("Family"), tabBarIcon: ICONS.family, ...memberOnly }} />
        <Tabs.Screen name="profile" options={{ title: t("Profile"), tabBarIcon: ICONS.profile, ...memberOnly }} />
      </Tabs>
      {!guest && <AlertToast />}
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: "center", justifyContent: "center", width: 44, height: 26, borderRadius: 13 },
  iconWrapOn: { backgroundColor: C.brandTint },
  tabIcon: { width: 20, height: 20 },
});
