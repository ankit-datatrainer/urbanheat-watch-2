export type SatelliteMapProps = {
  lat: number;
  lon: number;
  /** "heat": satellite surface temperature over satellite imagery; "photo": imagery only. */
  mode: "heat" | "photo";
  /** Re-coloured satellite heat tiles ({z}/{x}/{y}); null hides the heat layer. */
  heatTiles: string | null;
  hotspot?: { lat: number; lon: number } | null;
  zoom?: number;
  onPressPoint?: (lat: number, lon: number) => void;
  /** Marker for the last tapped point. */
  pin?: { lat: number; lon: number } | null;
};

/** Highest zoom the MODIS heat layer has; higher map zooms scale those 1 km pixels up. */
export const HEAT_NATIVE_ZOOM = 7;

// Esri World Imagery: satellite and aerial photos. No labels layer: its place dots were imprecise.
export const IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics · Heat: NASA MODIS (GIBS)";
