import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Circle, Marker, UrlTile } from "react-native-maps";
import { HEAT_NATIVE_ZOOM, type SatelliteMapProps } from "./shared";

const zoomToDelta = (z: number) => 360 / 2 ** z;

/** Native: Apple/Google satellite imagery (no place labels or landmark dots) with the heat layer on top. */
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
  const ref = useRef<MapView>(null);

  useEffect(() => {
    ref.current?.animateToRegion(
      { latitude: lat, longitude: lon, latitudeDelta: zoomToDelta(zoom), longitudeDelta: zoomToDelta(zoom) },
      400,
    );
  }, [lat, lon, zoom]);

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      mapType="satellite"
      showsPointsOfInterests={false}
      initialRegion={{
        latitude: lat,
        longitude: lon,
        latitudeDelta: zoomToDelta(zoom),
        longitudeDelta: zoomToDelta(zoom),
      }}
      onPress={(e) => onPressPoint?.(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
      rotateEnabled={false}
      pitchEnabled={false}
      accessibilityLabel="Satellite map"
    >
      {mode === "heat" && heatTiles && (
        <UrlTile
          urlTemplate={heatTiles}
          maximumNativeZ={HEAT_NATIVE_ZOOM}
          maximumZ={19}
          tileSize={256}
          opacity={0.8}
          zIndex={2}
        />
      )}
      {mode === "heat" && hotspot && (
        <Circle
          center={{ latitude: hotspot.lat, longitude: hotspot.lon }}
          radius={900}
          strokeColor="#D73027"
          strokeWidth={3}
          fillColor="rgba(255,255,255,0.35)"
          zIndex={3}
        />
      )}
      {pin && (
        <Marker
          coordinate={{ latitude: pin.lat, longitude: pin.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={styles.pin} />
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  pin: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#2B2320", borderWidth: 3, borderColor: "#FFFFFF" },
});
