import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { Colors } from '@/constants/theme';
import { decodePolyline, boundsOf, type LatLng } from '@/lib/geo';

export type LiveMapProps = {
  /** Trip endpoints. Omitted on the dashboard, which shows the driver, not a route. */
  pickup?: LatLng;
  drop?: LatLng;
  /** Centre for a route-less map (the dashboard). Ignored when pickup/drop are given. */
  center?: LatLng;
  /** Draws a marker for the device's own position. */
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

// Raster OSM tiles: no API key, so the map works before a Google key exists. On device the
// native variant (live-map.tsx) uses react-native-maps with the Google provider instead.
const OSM_STYLE: any = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Inline SVG so the marker needs no asset pipeline and can be recoloured from tokens. */
function truckMarkerElement(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '38px';
  el.style.height = '38px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.borderRadius = '50%';
  el.style.background = Colors.primary;
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
  el.style.border = '2px solid #ffffff';
  el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L12 17"/><path d="M6 9 L12 3 L18 9"/></svg>`;
  return el;
}

function dotMarkerElement(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '14px';
  el.style.height = '14px';
  el.style.borderRadius = '50%';
  el.style.background = color;
  el.style.border = '3px solid #ffffff';
  el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
  return el;
}

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
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // Bumped once the map instance exists, so the marker effect re-runs after a
  // (re)creation instead of waiting for the next position to happen to arrive.
  const [mapEpoch, setMapEpoch] = useState(0);
  const truckMarker = useRef<maplibregl.Marker | null>(null);
  const following = useRef(follow);
  // Kept in refs so the animation loop never restarts on re-render.
  const animation = useRef<number | null>(null);
  const current = useRef<LatLng | null>(null);
  const heading = useRef(0);

  useEffect(() => {
    if (!container.current || map.current) return;

    const hasRoute = Boolean(pickup && drop);
    const route = polyline ? decodePolyline(polyline) : hasRoute ? [pickup!, drop!] : [];

    // With no route to frame, open on the driver at street zoom instead of fitting bounds
    // around a single point (which maplibre resolves to its maximum zoom).
    const m = new maplibregl.Map({
      container: container.current,
      style: OSM_STYLE,
      ...(route.length > 1
        ? (() => {
            const b = boundsOf(route);
            return {
              bounds: [
                [b.minLng, b.minLat],
                [b.maxLng, b.maxLat],
              ] as [[number, number], [number, number]],
              fitBoundsOptions: { padding: 60 },
            };
          })()
        : (() => {
            const c = center ?? driver ?? pickup ?? DEFAULT_CENTER;
            return { center: [c.lng, c.lat] as [number, number], zoom: 13 };
          })()),
      attributionControl: false,
    });
    map.current = m;

    // Any manual pan/zoom hands control back to the user — a map that keeps yanking itself
    // back to the vehicle while you're trying to look ahead is worse than no follow at all.
    const stopFollowing = () => {
      following.current = false;
    };
    m.on('dragstart', stopFollowing);
    m.on('zoomstart', stopFollowing);

    // Markers attach to the map directly and do not need the style — adding them here
    // rather than inside a load handler means they show even if the style was already
    // cached and the load event fired before this effect ran.
    if (hasRoute) {
      new maplibregl.Marker({ element: dotMarkerElement(Colors.primary) })
        .setLngLat([pickup!.lng, pickup!.lat])
        .addTo(m);
      new maplibregl.Marker({ element: dotMarkerElement(Colors.secondaryContainer) })
        .setLngLat([drop!.lng, drop!.lat])
        .addTo(m);
    }

    // Stand-in for the native blue dot — the web build has no CoreLocation to defer to.
    if (showsUserLocation && center) {
      new maplibregl.Marker({ element: dotMarkerElement('#1a73e8') })
        .setLngLat([center.lng, center.lat])
        .addTo(m);
    }

    // Sources and layers DO need the style. Run immediately when it's already parsed,
    // otherwise wait for the event — relying on the event alone silently drops the route
    // line whenever the style resolves first.
    const drawRoute = () => {
      if (route.length < 2 || m.getSource('route')) return;
      m.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route.map((p) => [p.lng, p.lat]) },
        },
      });
      m.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': Colors.primary, 'line-width': 5, 'line-opacity': 0.85 },
      });
    };

    if (m.isStyleLoaded()) drawRoute();
    else m.on('load', drawRoute);

    // MapLibre measures its container once at construction. Inside an absolutely-filled
    // parent that measurement can land before layout settles, leaving the canvas smaller
    // than the box it sits in — tiles then cover only part of the screen and the rest
    // shows the container's background. Watch the element and resize with it.
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => m.resize())
        : null;
    if (observer && container.current) observer.observe(container.current);

    setMapEpoch((n) => n + 1);

    return () => {
      observer?.disconnect();
      if (animation.current) cancelAnimationFrame(animation.current);
      m.remove();
      map.current = null;
      // These refs outlive the map instance. React 18 StrictMode tears an effect down and
      // sets it up again, so without clearing them the next map would see a truck marker
      // that "already exists" — one belonging to the destroyed map — and quietly update a
      // detached element forever while the visible marker never moved.
      truckMarker.current = null;
      current.current = null;
      heading.current = 0;
      animation.current = null;
    };
    // Built once; live updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Glide the truck between GPS fixes instead of teleporting it. Fixes arrive every few
  // seconds; without interpolation the marker jumps, which reads as a broken map.
  useEffect(() => {
    const m = map.current;
    if (!m || !driver) return;

    if (!truckMarker.current) {
      truckMarker.current = new maplibregl.Marker({ element: truckMarkerElement(), rotationAlignment: 'map' })
        .setLngLat([driver.lng, driver.lat])
        .addTo(m);
      current.current = { lat: driver.lat, lng: driver.lng };
      if (driver.heading != null) heading.current = driver.heading;
      return;
    }

    const from = current.current ?? { lat: driver.lat, lng: driver.lng };
    const to = { lat: driver.lat, lng: driver.lng };
    const startHeading = heading.current;
    const endHeading = driver.heading ?? startHeading;
    const startedAt = performance.now();
    const DURATION = 900;

    if (animation.current) cancelAnimationFrame(animation.current);

    // requestAnimationFrame is paused while the page is hidden, so the tween would never
    // run and the marker would sit at a stale position until the user looked at it again.
    // Apply the update directly instead — the smoothing is a nicety, the position is not.
    if (typeof document !== 'undefined' && document.hidden) {
      truckMarker.current.setLngLat([to.lng, to.lat]);
      truckMarker.current.setRotation(endHeading);
      current.current = to;
      heading.current = endHeading;
      return;
    }

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION);
      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;

      // Rotate the short way round, so 350° -> 10° turns 20° rather than 340°.
      let delta = ((endHeading - startHeading + 540) % 360) - 180;
      const rot = startHeading + delta * t;

      truckMarker.current?.setLngLat([lng, lat]);
      truckMarker.current?.setRotation(rot);
      if (following.current) m.easeTo({ center: [lng, lat], duration: 0 });

      if (t < 1) {
        animation.current = requestAnimationFrame(step);
      } else {
        current.current = to;
        heading.current = endHeading;
      }
    };

    animation.current = requestAnimationFrame(step);
  }, [driver?.lat, driver?.lng, driver?.heading, mapEpoch]);

  // Mirrors the native map's fix: the mount effect above frames on whatever `center`/route
  // was available at construction time and never re-runs, so on the dashboard (no route,
  // no driver) the map would otherwise sit on the Kochi fallback forever, even once a real
  // GPS fix arrives afterward.
  useEffect(() => {
    const m = map.current;
    if (!m || pickup || drop || driver || !center) return;
    m.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center?.lat, center?.lng, pickup, drop, driver, mapEpoch]);

  return (
    <View style={[styles.wrap, style]}>
      {/* react-native-web renders this as a real div, which is what MapLibre mounts into. */}
      <div ref={container} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately no `flex: 1` here: inside a ScrollView that collapses to zero height and
  // the map silently disappears. The caller supplies the height via `style`.
  wrap: { overflow: 'hidden', backgroundColor: Colors.surfaceContainer, minHeight: 200 },
});
