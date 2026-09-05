import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Colors } from '@/constants/theme';
import { decodePolyline, boundsOf, type LatLng } from '@/lib/geo';

export type LiveMapProps = {
  /** Trip endpoints. Omitted on the dashboard, which shows the driver, not a route. */
  pickup?: LatLng;
  drop?: LatLng;
  /** Centre for a route-less map (the dashboard). Ignored when pickup/drop are given. */
  center?: LatLng;
  /** Draws the OS blue dot for the device's own position. */
  showsUserLocation?: boolean;
  /** Encoded route from the backend; drawn as the road line, not a straight dash. */
  polyline?: string | null;
  /** Live driver position. Null until the first GPS fix arrives. */
  driver?: (LatLng & { heading?: number }) | null;
  /** Keeps the camera on the truck; turns itself off when the user pans. */
  follow?: boolean;
  style?: any;
};

/** Falls back to Kochi so a route-less map with no fix yet still opens somewhere sensible. */
const DEFAULT_CENTER: LatLng = { lat: 9.9312, lng: 76.2673 };

/**
 * Native map. Uses the Google provider on Android to match the original app
 * (decompiled: RNMapsGoogleMapView), which requires the render key in app.config.js.
 */
export function LiveMap({
  pickup,
  drop,
  center,
  showsUserLocation,
  polyline,
  driver,
  follow = true,
  style,
}: LiveMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [following, setFollowing] = useState(follow);
  const heading = useRef(0);

  const hasRoute = Boolean(pickup && drop);

  const route = useMemo(() => {
    if (polyline) return decodePolyline(polyline);
    return pickup && drop ? [pickup, drop] : [];
  }, [polyline, pickup, drop]);

  const initialRegion: Region = useMemo(() => {
    // No route to frame — centre on the driver (or the fallback) at street zoom.
    if (route.length < 2) {
      const c = center ?? driver ?? pickup ?? DEFAULT_CENTER;
      return { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    }
    const b = boundsOf(route);
    return {
      latitude: (b.minLat + b.maxLat) / 2,
      longitude: (b.minLng + b.maxLng) / 2,
      // Padding so the whole route is visible rather than clipped at the edges.
      latitudeDelta: Math.max(0.02, (b.maxLat - b.minLat) * 1.4),
      longitudeDelta: Math.max(0.02, (b.maxLng - b.minLng) * 1.4),
    };
  }, [route, center, driver, pickup]);

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

  // `initialRegion` is a one-time native prop — react-native-maps ignores every value
  // after the first. On the dashboard, `center` starts undefined (GPS hasn't resolved
  // yet), so the map mounts on the Kochi fallback and, without this, never moves again
  // even once a real fix arrives. Scoped to the no-route, no-driver case so it can't
  // fight the trip screen's own driver-follow behaviour above.
  useEffect(() => {
    if (hasRoute || driver || !center || !mapRef.current) return;
    mapRef.current.animateCamera(
      { center: { latitude: center.lat, longitude: center.lng } },
      { duration: 600 },
    );
  }, [center?.lat, center?.lng, hasRoute, driver]);

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
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
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

        {hasRoute ? (
          <>
            <Marker coordinate={{ latitude: pickup!.lat, longitude: pickup!.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
            </Marker>
            <Marker coordinate={{ latitude: drop!.lat, longitude: drop!.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.dot, { backgroundColor: Colors.secondaryContainer }]} />
            </Marker>
          </>
        ) : null}

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
