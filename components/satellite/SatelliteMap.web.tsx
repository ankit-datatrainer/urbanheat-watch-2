import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { ATTRIBUTION, HEAT_NATIVE_ZOOM, IMAGERY_URL, type SatelliteMapProps } from "./shared";

const CSS = `
.uhw-heat img { image-rendering: pixelated; }
.uhw-hot { position: relative; width: 18px; height: 18px; }
.uhw-hot::before, .uhw-hot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; }
.uhw-hot::before { background: #fff; border: 4px solid #D73027; box-sizing: border-box; }
.uhw-hot::after { border: 2px solid #D73027; animation: uhw-ping 1.8s ease-out infinite; }
@keyframes uhw-ping { from { transform: scale(1); opacity: .9 } to { transform: scale(3.2); opacity: 0 } }
.leaflet-container { background: #0E1A2B; font-family: InstrumentSans_400Regular, system-ui, sans-serif; }
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("uhw-map-css")) return;
  const el = document.createElement("style");
  el.id = "uhw-map-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** Web: Leaflet with satellite imagery and the satellite heat layer (no place labels or landmark dots). */
export default function SatelliteMap({
  lat,
  lon,
  mode,
  heatTiles,
  hotspot,
  zoom = 10,
  onPressPoint,
  pin,
}: SatelliteMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const heat = useRef<L.TileLayer | null>(null);
  const hot = useRef<L.Marker | null>(null);
  const pinLayer = useRef<L.CircleMarker | null>(null);
  const press = useRef(onPressPoint);

  useEffect(() => {
    press.current = onPressPoint;
  }, [onPressPoint]);

  useEffect(() => {
    if (!container.current || map.current) return;
    injectCss();
    const m = L.map(container.current, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 16,
    }).setView([lat, lon], zoom);
    L.tileLayer(IMAGERY_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => press.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    // React Native Web lays out after mount; keep Leaflet's size in sync.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      heat.current = null;
      hot.current = null;
      pinLayer.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setView([lat, lon], zoom, { animate: true });
  }, [lat, lon, zoom]);

  // Heat layer: shown in heat mode when tiles exist.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const want = mode === "heat" && heatTiles;
    if (!want) {
      heat.current?.remove();
      heat.current = null;
      return;
    }
    if (heat.current) heat.current.setUrl(heatTiles);
    else {
      heat.current = L.tileLayer(heatTiles, {
        maxNativeZoom: HEAT_NATIVE_ZOOM,
        maxZoom: 19,
        opacity: 0.8,
        className: "uhw-heat",
        zIndex: 400,
      }).addTo(m);
    }
  }, [mode, heatTiles]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    hot.current?.remove();
    hot.current = null;
    if (hotspot && mode === "heat") {
      hot.current = L.marker([hotspot.lat, hotspot.lon], {
        icon: L.divIcon({ className: "", html: '<div class="uhw-hot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
      }).addTo(m);
    }
  }, [hotspot, mode]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pinLayer.current?.remove();
    pinLayer.current = null;
    if (pin) {
      pinLayer.current = L.circleMarker([pin.lat, pin.lon], {
        radius: 7,
        color: "#FFFFFF",
        weight: 3,
        fillColor: "#2B2320",
        fillOpacity: 1,
      }).addTo(m);
    }
  }, [pin]);

  return <div ref={container} style={{ position: "absolute", inset: 0, zIndex: 0 }} />;
}
