// Extends app.json at build time so the Google Maps render key comes from the
// environment instead of being committed. Expo reads app.json first and hands it
// here as `config`.
//
// Set GOOGLE_MAPS_ANDROID_KEY in .env (or as an EAS secret). This key is the only one
// that legitimately ships inside the app — it is render-only, and it must be restricted
// in Google Cloud by Android package name + SHA-1 fingerprint. Every other Google API
// (Places, Directions, Geocoding) is proxied through the backend so its key never leaves
// the server.
const googleMapsKey = process.env.GOOGLE_MAPS_ANDROID_KEY;

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    // Only emit the block when a key actually exists. Passing `apiKey: undefined` writes a
    // malformed manifest entry, which fails the native build with an error that points at
    // the manifest rather than at the missing variable. Without a key the app still builds
    // and runs — the map view is simply blank until one is supplied.
    ...(googleMapsKey
      ? { config: { ...config.android?.config, googleMaps: { apiKey: googleMapsKey } } }
      : {}),
  },
});
