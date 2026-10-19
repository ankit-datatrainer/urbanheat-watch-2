import { Platform } from "react-native";

// Shared palette, taken from the UrbanHeat Watch logo (sprout green + thermometer orange on cream).
export const C = {
  bg: "#FBF1E4",
  bgDeep: "#F6E6D2",
  surface: "#FFFFFF",
  surfaceWarm: "#FFF9F2",
  border: "#EADBC8",
  borderStrong: "#DCCAB4",
  ink: "#2B2320",
  inkSoft: "#5E5148",
  inkMuted: "#958778",
  brand: "#F07B2E",
  brandDeep: "#D9621A",
  brandTint: "#FDEBDD",
  leaf: "#5C9C7E",
  leafLight: "#7DBF9C",
  leafTint: "#E4F2EA",
  bulb: "#E8915A",
  low: "#2E9E7E",
  moderate: "#F0A52E",
  high: "#E0533D",
  highTint: "#FDEDEC",
  moderateTint: "#FEF5E7",
  lowTint: "#E8F8F2",
  info: "#3F87D9",
  infoTint: "#E8F1FB",
  violet: "#7B5CF0",
};

export const R = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };

/**
 * Type families. Bricolage Grotesque for headlines and numbers, Instrument Sans for everything else.
 * Custom fonts carry their weight in the family name, so styles use these instead of fontWeight.
 * Scripts these fonts don't cover (Chinese, Hindi, Tamil, Telugu) fall back to the system font.
 */
export const F = {
  displayThin: "BricolageGrotesque_200ExtraLight",
  displayLight: "BricolageGrotesque_300Light",
  displayMedium: "BricolageGrotesque_500Medium",
  display: "BricolageGrotesque_600SemiBold",
  body: "InstrumentSans_400Regular",
  bodyMedium: "InstrumentSans_500Medium",
  bodySemi: "InstrumentSans_600SemiBold",
};

export const shadow = (depth: 1 | 2 | 3 = 1) =>
  ({
    shadowColor: "#3D2A1A",
    shadowOpacity: [0.05, 0.09, 0.14][depth - 1],
    shadowRadius: [8, 14, 22][depth - 1],
    shadowOffset: { width: 0, height: [2, 5, 10][depth - 1] },
    elevation: depth * 2,
  }) as const;

// The web build can't run animations on the native driver; Reanimated handles this itself.
export const isWeb = Platform.OS === "web";
