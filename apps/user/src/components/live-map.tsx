import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Colors } from '@/constants/theme';
import { decodePolyline, boundsOf, type LatLng } from '@/lib/geo';

export type LiveMapProps = {
  pickup: LatLng;
  drop: LatLng;
  /** Encoded route from the backend; drawn as the road line, not a straight dash. */
  polyline?: string | null;
  /** Live driver position. Null until the first GPS fix arrives. */
  driver?: (LatLng & { heading?: number }) | null;
  /** Keeps the camera on the truck; turns itself off when the user pans. */
  follow?: boolean;
  style?: any;
};

/**
 * Native map. Uses the Google provider on Android to match the original app
 * (decompiled: RNMapsGoogleMapView), which requires the render key in app.config.js.
 */
export function LiveMap({ pickup, drop, polyline, driver, follow = true, style }: LiveMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [following, setFollowing] = useState(follow);
  const heading = useRef(0);

  const route = useMemo(
    () => (polyline ? decodePolyline(polyline) : [pickup, drop]),
    [polyline, pickup, drop],
  );

  const initialRegion: Region = useMemo(() => {
    const b = boundsOf(route.length > 1 ? route : [pickup, drop]);
    return {
      latitude: (b.minLat + b.maxLat) / 2,
      longitude: (b.minLng + b.maxLng) / 2,
      // Padding so the whole route is visible rather than clipped at the edges.
      latitudeDelta: Math.max(0.02, (b.maxLat - b.minLat) * 1.4),
      longitudeDelta: Math.max(0.02, (b.maxLng - b.minLng) * 1.4),
    };
  }, [route, pickup, drop]);

  if (driver?.heading != null) heading.current = driver.heading;

  // Follow the truck by animating the camera. `animateCamera` interpolates natively, so the
  // marker glides between GPS fixes instead of jumping.
  useEffect(() => {
    if (!following || !driver || !mapRef.current) return;
    mapRef.current.animateCamera(
      { center: { latitude: driver.lat, longitude: driver.lng }, heading: heading.current },
      { duration: 900 },
    );
  }, [driver?.lat, driver?.lng, following]);

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        // Any manual pan hands control back to the user — a map that keeps yanking itself
        // back to the vehicle while you're looking ahead is worse than no follow at all.
        onPanDrag={() => setFollowing(false)}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {route.length > 1 ? (
          <Polyline
            coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={Colors.primary}
            strokeWidth={5}
          />
        ) : null}

        <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
        </Marker>
        <Marker coordinate={{ latitude: drop.lat, longitude: drop.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={[styles.dot, { backgroundColor: Colors.secondaryContainer }]} />
        </Marker>

        {driver ? (
          <Marker
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            // `flat` makes the marker rotate with the map, like a vehicle on a road rather
            // than a pin standing upright.
            flat
            rotation={heading.current}
          >
            <View style={styles.truck}>
              <MaterialIcons name="navigation" size={20} color={Colors.onPrimary} />
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately no `flex: 1` here: inside a ScrollView that collapses to zero height and
  // the map silently disappears. The caller supplies the height via `style`.
  wrap: { overflow: 'hidden', backgroundColor: Colors.surfaceContainer, minHeight: 200 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#ffffff' },
  truck: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
