import { View } from "react-native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import {
  BricolageGrotesque_200ExtraLight,
  BricolageGrotesque_300Light,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
} from "@expo-google-fonts/bricolage-grotesque";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans";
import { AuthProvider } from "../context/auth";
import { CityProvider } from "../components/CityContext";
import { FamilyProvider } from "../context/family";
import { AlertsProvider } from "../context/alerts";
import { LanguageProvider } from "../lib/i18n";

export default function LayoutOrder() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_200ExtraLight,
    BricolageGrotesque_300Light,
    BricolageGrotesque_500Medium,
    BricolageGrotesque_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  // A font that fails to load falls back to the system font rather than blocking the app.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: "#FBF1E4" }} />;

  return (
    <LanguageProvider>
      <AuthProvider>
        <CityProvider>
          <FamilyProvider>
            <AlertsProvider>
              <Stack screenOptions={{ headerShown: false, animation: "fade_from_bottom" }}>
                <Stack.Screen name="index" options={{ animation: "fade" }} />
                <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
                <Stack.Screen name="login" options={{ animation: "fade" }} />
                <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
                <Stack.Screen name="ai" options={{ presentation: "card", animation: "slide_from_bottom" }} />
                <Stack.Screen name="invite" options={{ presentation: "card", animation: "slide_from_bottom" }} />
              </Stack>
            </AlertsProvider>
          </FamilyProvider>
        </CityProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
