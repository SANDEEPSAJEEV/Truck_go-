// Sanity-checks the hand-written polyline used by demo mode. A malformed encoded string
// still "decodes" — it just produces coordinates in the wrong hemisphere, which shows up
// as a blank map rather than an error.
import { decodePolylineServer } from "./polyline-util";

const DEMO =
  "ektmAcvxxMuAoDaCyGwAwDaAiCq@_BgAmC_@aAg@sAWq@]{@]}@Wo@Yu@a@eAg@qAg@qAg@oAe@mAe@kAg@mAg@mAe@kAg@mAg@mAe@kAg@mAg@mAe@kAg@mAg@mAe@kAg@mAg@mA";

const pts = decodePolylineServer(DEMO);
const lats = pts.map((p) => p.lat);
const lngs = pts.map((p) => p.lng);

console.log("points:", pts.length);
console.log("first :", JSON.stringify(pts[0]));
console.log("last  :", JSON.stringify(pts[pts.length - 1]));
console.log("lat range:", Math.min(...lats).toFixed(4), "->", Math.max(...lats).toFixed(4));
console.log("lng range:", Math.min(...lngs).toFixed(4), "->", Math.max(...lngs).toFixed(4));
console.log("expected : lat ~9.97-10.53, lng ~76.21-76.24 (Kochi -> Thrissur)");
