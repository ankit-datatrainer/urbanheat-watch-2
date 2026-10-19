import { View } from "react-native";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useAlerts } from "../../context/alerts";
import { useAuth } from "../../context/auth";
import { useT } from "../../lib/i18n";
import AlertToast from "../../components/alerts/AlertToast";

const TAB_ICONS = {
  home: require("../../assets/Icons/house.png"),
  heatmap: require("../../assets/Icons/location.png"),
  alerts: require("../../assets/Icons/bell.png"),
  family: require("../../assets/Icons/family.png"),
  profile: require("../../assets/Icons/user.png"),
};

export default function TabsLayout() {
  const { unread } = useAlerts();
  const { user, loading, isGuest } = useAuth();
  const t = useT();

  // Every tab needs an account; guests may only use Home.
  if (!loading && !user && !isGuest) return <Redirect href="/login" />;
  const guest = isGuest && !user;

  return (
    <View style={{ flex: 1 }}>
      <NativeTabs tintColor="#F07B2E" minimizeBehavior="onScrollDown" hidden={guest}>
        <NativeTabs.Trigger name="home">
          <NativeTabs.Trigger.Icon src={TAB_ICONS.home} sf={{ default: "house", selected: "house.fill" }} md="home" />
          <NativeTabs.Trigger.Label>{t("Home")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="heatmap" hidden={guest}>
          <NativeTabs.Trigger.Icon src={TAB_ICONS.heatmap} sf={{ default: "map", selected: "map.fill" }} md="map" />
          <NativeTabs.Trigger.Label>{t("Heat map")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="alerts" hidden={guest}>
          <NativeTabs.Trigger.Icon
            src={TAB_ICONS.alerts}
            sf={{ default: "bell", selected: "bell.fill" }}
            md="notifications"
          />
          <NativeTabs.Trigger.Label>{t("Alerts")}</NativeTabs.Trigger.Label>
          {unread > 0 && <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge>}
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="family" hidden={guest}>
          <NativeTabs.Trigger.Icon
            src={TAB_ICONS.family}
            sf={{ default: "person.2", selected: "person.2.fill" }}
            md="group"
          />
          <NativeTabs.Trigger.Label>{t("Family")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="profile" hidden={guest}>
          <NativeTabs.Trigger.Icon
            src={TAB_ICONS.profile}
            sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
            md="person"
          />
          <NativeTabs.Trigger.Label>{t("Profile")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      {!guest && <AlertToast />}
    </View>
  );
}
