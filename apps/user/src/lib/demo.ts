/**
 * Demo mode — runs the whole rider app with no backend and no database.
 *
 * Enabled with EXPO_PUBLIC_DEMO=1. Every `apiFetch` is served from the in-memory store
 * below instead of the network, and the socket is replaced by a simulator that drives a
 * truck along a real route so live tracking can be seen without a driver app running.
 *
 * The store is deliberately MUTABLE: accepting a bid, verifying a PIN and advancing a trip
 * all change state, so the flow actually progresses. A read-only mock would look like a
 * broken app the moment you tapped anything.
 *
 * This is for looking at the UI. It is not a test double for the API contract — the real
 * server remains the only thing that decides what is true.
 */

export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';

type Json = Record<string, any>;

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// A real Kochi -> Thrissur road route (encoded polyline), so the map draws an actual road
// line rather than a straight dash between two pins.
const DEMO_ROUTE =
  'kzy{@onjpMQA_B@SC?OHw@DOFOs@McVTyAJu@FoCh@IDCDAH?FDLLZVr@?NCBGFCBQHSHOFMHEBMJYTA@GDIJMRc@x@KRGJGHYX[T{AdAKHa@Zy@l@a@VGDIDWJ_@LYHa@LODOBm@JA?oAT_@HG@g@Ja@BM@M@YAmAAmAES?iFIg@?O?eA?[?G?s@AE?[?OBg@CEBE@G?KEg@Ds@BiB?yAAG@U?c@DkAP}@LSDsARQB{Bd@WDaBVODe@H]FmAXsAZWFmBf@qBf@eATe@NaAVy@RmDv@aB\i@JUF[P[Tq@^m@Ti@Dg@R]Fi@H]JQFa@P_@Lg@N{Bt@a@NeA\UFaBh@IB{A^yAj@[JiCz@oCx@k@TYH{Bn@iA\eCr@[JQDE@KDC@o@^gAj@MFIFYNYLg@Ps@VMFq@Tq@Va@NMFq@VQHWLcA`@]LUJYLcAb@_@Lk@Ry@X}@Xg@NeA`@MFyAl@]HUF_@Hc@HYH[HUH_@LcA`@y@\UJq@XKDoAl@eAf@qBr@SHk@L]JWJu@^sAp@{@`@m@V}@b@SJs@ZSJw@XiAb@WLKDSJIDIFWNGB_@VOH}@f@[PQJw@^YLoCbAa@LMFuFlBeA^iA`@}@X_@L]L{@VqBl@_AZcA\y@\UHODe@JE?a@FkBTuAPOBG@oBZ_BXsATSD}@NOBOBc@FwBVG?I@i@H_@DGB_A\gA`@c@J_ATYFqCn@KBaATmCn@qAVUD{@XuBd@q@Nk@Jc@Jk@LmAT]H}A\m@Nm@NI@{Bd@kATk@JODuCh@sB\kATKBMBc@Jg@LQD_@Ja@FUFm@LQBcEt@q@LeB\UDuB^m@Lq@LeCd@qAVy@LkAL_@DaALg@JiFdA[HUFC?y@Ps@NuAVYFoAT}@N{Bb@oAVMB_APWDc@@YBYD[B_@Fa@HyB\}@HoC^wAX{Cn@yBjAiBd@[JWFiDz@m@JsA@YAoCWKA_@A[Be@BcALgAFw@As@Ju@Ny@T_@Ju@Tw@TyAf@w@Ti@Ly@Vy@Ve@Lk@Lc@Dy@Bk@B[DmANuANq@Jc@JE@m@Nq@Pm@NGBe@HMDg@Lo@H_@Da@@M@o@B_@@Q@K@iABe@?G?s@Dk@Du@Di@@aBDa@@_@DSBW@UBm@Jy@JI@cALqCb@eANE@c@Fa@HyATg@Fo@FM@{DVmAF{APoBLa@Bk@As@A_BLI?UBe@DoAHeBT{ARQBcANA?c@Hi@Ju@LQBC@s@JqANc@F{@NiALoBZqBVYBi@JkAPkALE?SDWB[Bs@La@Fc@FG@WBk@Le@FgANm@Ho@PYD}B^q@JkALy@Hq@Hs@Jy@La@DSBo@JQ@_@Da@F_@HqBZgB\a@FaC^u@N]DwATsANk@FG@gATa@HWD_BT{@Ne@HmBV_C`@}Bb@g@He@JmB\o@NaAPWFOHaAPq@Ra@HqAV}AP{@VKBmARkATQDc@HeAPgARo@Ju@N}@V{AVKBs@LKBgAT{@N}A\_@H]H_@FaAPg@J]HOBa@F}@Nk@N[FE@[Hw@LiAT[FI@[B{@Hs@Hy@Js@Nk@DaBVqARmATG@_BVeAP_@DODIHEHAN?JAVCPGLCBIBIB{AZQDu@PUBI@KEECGM?IIg@EOIGGCKASAqBLWB[ByANkCTM@SBk@J_@JSDk@NeA\o@Ta@LcBn@wA\iAVOBiBb@k@Lq@PKBeAX[FmA\kAXy@ZE@IBa@Jc@FKBUBm@Ha@FgANaB\_@Hi@JOB}AZaB^EBQD_@Hm@H{@Js@H}@Hs@FkAH_AFi@?gB?w@Bw@Ji@FK@qBVSDqARqAV_@Hw@PwAZgARA@iARK@e@Ja@Dq@HOBgAPs@NqAVc@Lc@P_@Ly@Zs@Vq@VEB_A\[HKDYJSFSDYB_ANYDE?_@Fk@HiAHe@D[Du@F_BJaAHYDOB]HUHa@NWHcBp@[Js@TMFy@Tq@P}Ad@_@HiATKBk@Jm@Hk@JYDE@]DYBSDC?K@GBu@NC@aAL[Dk@FcAR}@P}@PcAPe@JgB^}@TG@a@Jg@NQDGBEDEFCHAJ?~BARAJGHGDSHKByA`@_@Lq@PqAZ_@JE?]HwA`@s@Ti@Ny@R]Li@RIBaA\c@J_@Lo@Pm@NOFw@NG@y@Le@@]CYQQOIGEAI?U@WDWDQDiB\i@HUDi@LIB{@X[J{A`@QBuAVaCd@w@Tq@Ru@\e@VUPWVONa@`@u@f@i@TID_@Ju@RkATg@HeATQDODy@Ra@Pm@\aAh@m@\mCzAk@Za@VcBhAo@h@YVqBzAk@\_CxAeB|@OFuBt@[JmAZg@Ny@TYJ_AVYFmB`@eAj@cBrAMJcCpAWLKFmA^a@LMB[HyCv@eATWFoA\gAZE@cBn@qBr@EB}Ah@SPa@`BUdBRp@x@nBHPAZMJcA^qAb@QFQFE@KUQa@s@kA{AwBsGcKw@cAeAkAUScAm@g@Qa@CsAH[JKDu@fBUd@]f@]\k@`@eCrAMDSDm@FK?g@?e@DaBVc@Dq@E[M]]GGw@_BGOwC}Bi@sAIi@COAm@CUe@mFI_AE]CGEEO[W_@{AgCe@w@S{@QuAAG_@wCK}@AIKkA@e@DkCBmB?a@Am@?YCmA?_@AoB@aA@k@[Ug@Oe@IaAYSQIQE]?GMwEK]SK_@Ag@Qs@oAaAgAEIu@{AO][cBw@mA]cAAIu@eESuByAmAy@q@SQaAo@[e@Mm@[s@g@mACG]wAc@g@]q@MwAeA_BMm@??CQaAN{@@cFRmCLsFTaHViDT_DLsAFc@BwBNmBHc@ByBLoAFwCL_Ib@cADM?i@BgC`@WFcAFyAJc@ByCJ{@BuADmEDyA?aA@}@@iBHwAJiAN{ATkATeCl@uBd@iBb@oA^cBZeCl@_@JG@k@Pq@ReCh@aCj@sDbAsAZ{Ab@y@VwAd@qA`@uAZuAVgEh@oCP}CRa@Bs@BoA?uCHaC?sB?gCCgA?aC@{C@{@@Q?Y@c@Dc@BgD\qCXUR}@D_ADaBBsBBgA@Y?uALiD\gEl@}Bj@m@NaBj@yCt@cAV{@RaEbAcDn@_D|@wBl@cD~@kBd@k@N{A^kCbAu@\}@f@oAl@m@X]P{@b@wBx@cExAqEzAiCz@kBn@cBn@uClAoExBeIhDwBv@sAl@a@Vc@XcBt@uEjBgBn@s@X]JYHWHmAViF~@oEt@yE|@cBZu@\mAj@eAl@_Al@iAt@gAp@eCxAm@\_Bv@kChAuAj@aA\oGpB{Cz@i@RwAb@oCfA_CzAoCfBo@^{BvAgClA]NwAnAe@d@q@bA_@d@mA|AqBjBWPmC|Be@h@}@bAeCxDW`@o@l@}@n@GBy@^c@JWDoANmAL[J?XEp@Cl@EJOFsBTyCToA@[AuACc@@]Gk@OQGi@SKCo@OWA_AAe@?C?wANc@NoBr@Q@qB`@uAVeAHWBgABqA?_@?o@?k@DkAFyBZe@H_AN}ATg@TYNaAn@UTc@`@GD}@r@}@bAIBIFKDa@R_Ab@MD}@b@k@^e@d@[^a@f@[ZoBdB]ZGJEDW^U\s@n@w@l@_@`@[l@_@`AId@SJIEa@cAQc@q@yAGQwEaGiB{BqCkD}AiBe@m@m@y@[qAEgAVu@BaAKqAiAoFYyAOWs@mA_AoBmCiE[_@Yw@CuA]{C]aCKiAU_BAIEUUwBFsBE_CRyAJo@Ny@?mBIsAC_@OkBq@sB[gADYFQ^]BCp@UPEtAa@JCn@O~@Q^OHUBgAYeBAKa@eE_AaHEYM}@]wBe@eDm@gEQwAK[YsCY{BQwBCYq@gEm@{C}@qGA_@I}CEo@AYMkCMmBWgBCWSsBYkBEe@Ig@EeAAi@AEEIEKQSKYGUAI?g@B_@Be@Da@BYDy@@q@C]AOC]?[Ae@@i@Ba@B[@KFa@BWDg@BgA?kAGyAGgACaBGiAA_A?g@C[AOAcAGm@Ig@I]Im@O}@G_@US_@]k@k@SSa@u@q@gCOi@WaAEUCIOs@Gc@Eo@?e@@c@@_@As@?e@C_@Ga@Gm@K_AQ}@Qm@Oa@m@_Ba@iAWm@GSe@{ACGWq@K_@]kAmBDaABqE@S?QC{A[uMiCw@M[EuEi@g@Cs@AM?oAAqMZkAD_BF]@oBLcBH[Bc@B{ALsALsAReDj@IBg@F}G|@kANy@HOBQ?uBPaADM?]@}ADuA?cB?e@BgFViAJyBXi@Ji@RQNGT?b@Jd@Rt@@d@@PIJmAl@wDhAa@HYBmCLoAFiADq@BuDJw@Dm@BoBDoACSAoEI_@AwACyBE[AiKUOAgAEmAGi@AcCOcDSuAIGAmDSsBOg@GkAM[CoDYeCKg@C}DUG?aEMUA_DSg@G}B_@aCSiE]sFw@aEk@YEkI{@UC_@EaGe@iE]s@G]CwFg@}AGy@Ay@DyCR{@HaAFiA@_A@cAAu@Cm@A}BGQ?i@CO?oBGeBIwDOK?WAsDQeBMmAIaBM_AKq@Eo@I{A]k@MkBo@cGeCeAa@q@WyCw@IAoAKuDSu@FY@{AJwDd@UDsNnDQDi@J}Bh@u@Da@@i@?{@C{A?y@CgAE}AUgBUYCcI}@s@M{Ci@GAkASkAMG?gAM_CQG?eHQy@?wEHsLp@G?Q@g@Bi@BI@uAJi@DgARaH~@{C^g@FqC^yALmA?[CWA]?w@Cw@IgBYSAKBULaDzAc@LoAV_Cd@cCVSDQHSNmAfBEHgApBw@`Bi@vAk@xAIJMBI@_@CqD[U?K@MDk@b@_Ap@wCdCMJWRkAj@[JkBf@wATqAFS@mCLc@BWBk@@gERcBH_ADaA@u@@cBD]B}D`@o@DeBDkAJa@Du@DgBLaQjAaAFsETsEIcAMi@GyB}@W[{AsAa@YmA}@{@k@gAu@YUICaAY]KaAYmBm@aBUa@Co@EgBI{@E]CuBUcCU_Da@]AqC{@a@MyBc@kAEe@Fe@DsAJq@DgFQaFUKAmAGe@IgA{@aAk@a@_@UMyAo@MESE]KeDAeFGk@AkCE_@?iBEU?k@?e@EYC]CWEg@CMZq@bBy@dBuAxCm@lAKTcAlBYf@EHOT[b@}AnB_AhAm@r@e@f@k@p@qAbDkAlCc@`AYr@Sh@[`AGPUx@cAZqBZiAFQBw@FM@eAJaBLcAP_@H]LyAb@KDmAZUF_@HM@e@DeAF_@?aAAu@Eg@ASAk@@oAHmBNcA?y@GqAQeAM}@GyAGC?}@CkDAgCFo@D{@FaB@cD?wBEE?W?_AOo@Qq@OOEu@MuB[c@S}Ai@sA_@YIw@Uu@Qk@Se@Om@QQCiAMGAi@G{BWk@GiAGeBQuCIgBG}CMSAaAEwAAk@CWC_@E]KmBg@WIw@WIEgAc@g@U}@Y_@MmAe@e@OoAa@e@MiEwAeDgAQMMQEMu@mBMQOKQEq@@kD?g@CaBSm@Io@Kq@KSEuASSEsCc@{AQgAM}AWa@C[Am@Bo@FaB\}Bn@y@P{Bb@oBp@YJq@@}BQe@K_@Io@QqAWi@Ge@CmAL[H]LSHSJ_@ZiBbBQDs@@o@D]H_@RMHy@h@g@\YRa@NODa@@gABU?iAIg@Eu@GgD_@qBKc@CwB@G@eBJS@Q@YBiCb@gAL_@F{E\qAHe@DwAJ{BJe@D[BU@W@u@FS@q@FWBC?m@JIBI@SL_@FWDi@FwB\a@HWDq@PU@SFEBeA\WF_@Ha@DA?y@Fm@DiAF[@kBD_@@m@@w@D{@BoBJi@@c@Aw@Bc@?m@Ea@A_@?{@BE?e@@e@@M?S?}@EMAM?W@YDYFOBe@@k@EQASASCWCMASAe@EI?M@Y@WD]FWF_@La@Jm@Rg@JI@a@HQDSBM?O@_@@M?OA]C[Eo@Is@KgAUu@Uo@Sc@IKCSCUGi@KcAMc@?eAA]Gs@OcAQDp@?n@?V?nB@T@^Bd@@DAD?DAFCBADEDEDE@GBG@i@?IAgAAoBA[?MGEMCU?]EmBCe@KwBiAByAC{@BwBC}AIuAKICGGEKAW?k@CMOK]EcADC?U@a@?i@Co@Kc@H[He@FE?WBq@@I?e@AK?[A]?cC?aA?cA@]?_@E_@MQK_@MWc@EGg@_B[cAOg@Uq@q@mBUE';

let seq = 1;
const nextId = () => `demo-${seq++}`;

/** One canned booking, at whatever stage the viewer has pushed it to. */
type DemoBooking = Json;

function makeBooking(over: Json = {}): DemoBooking {
  return {
    id: nextId(),
    reference: `TRK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    userId: 'demo-rider',
    driverId: null,
    status: 'AWAITING_BIDS',
    pickupAddress: 'Marine Drive, Kochi, Ernakulam, Kerala',
    pickupLat: 9.9679,
    pickupLng: 76.2444,
    dropAddress: 'Swaraj Round, Thrissur, Kerala',
    dropLat: 10.5276,
    dropLng: 76.2144,
    vehicleType: 'tataAce',
    weightTons: 2,
    goodsType: 'Steel rods',
    notes: null,
    distanceKm: 74.3,
    durationMin: 85,
    estimatedFare: 1566,
    actualFare: null,
    routePolyline: DEMO_ROUTE,
    pickupOtp: null,
    startOtp: null,
    dropOtp: null,
    createdAt: now(),
    ...over,
  };
}

const store = {
  user: {
    id: 'demo-rider',
    role: 'USER' as const,
    fullName: 'Arun Menon',
    companyName: 'Menon Traders',
    phone: '9876543210',
    email: 'arun@menontraders.in',
    avatarUrl: null,
  },
  bookings: [] as DemoBooking[],
  notifications: [
    { id: 'n1', title: 'Driver arriving soon', body: 'Rajesh is 5 minutes from your pickup location.', isRead: false, createdAt: minutesAgo(9) },
    { id: 'n2', title: 'Bid received', body: 'A driver offered ₹1,650 for your Kochi shipment.', isRead: false, createdAt: minutesAgo(28) },
    { id: 'n3', title: 'Delivery completed', body: 'Your shipment TRK-92814A was delivered successfully.', isRead: true, createdAt: minutesAgo(180) },
  ],
  bids: {} as Record<string, Json[]>,
  // bookingId -> payment status. Mirrors the real backend's rule: only ever written by
  // "the webhook" (mock-complete below, standing in for it), never by the client directly.
  payments: {} as Record<string, 'NONE' | 'PENDING' | 'PAID'>,
};

// Seed: one live booking taking bids, plus history so Trip History isn't empty.
const live = makeBooking();
store.bookings.push(live);
store.bids[live.id] = [
  {
    id: 'bid-1',
    amount: 1566,
    note: 'Empty truck nearby, can reach in 10 minutes.',
    status: 'PENDING',
    createdAt: minutesAgo(2),
    driver: { id: 'd1', fullName: 'Rajesh Kumar', ratingAvg: 4.8, ratingCount: 124, vehicleType: 'tataAce', vehicleNumber: 'KL 07 AB 1234' },
  },
  {
    id: 'bid-2',
    amount: 1720,
    note: 'Covered truck, tarpaulin included.',
    status: 'PENDING',
    createdAt: minutesAgo(1),
    driver: { id: 'd2', fullName: 'Suresh Nair', ratingAvg: 4.9, ratingCount: 302, vehicleType: 'tataAce', vehicleNumber: 'KL 11 CD 5678' },
  },
];

// Left unpaid on purpose — this is the trip that exercises the "reopen the app later and
// tap an already-delivered trip" path into the payment screen, rather than the live
// just-arrived-at-DELIVERED path that the active booking above will take.
const deliveredUnpaid = makeBooking({
  status: 'DELIVERED',
  driverId: 'd1',
  actualFare: 1350,
  dropAddress: 'Kozhikode Beach, Kozhikode, Kerala',
  createdAt: minutesAgo(60 * 26),
  completedAt: minutesAgo(60 * 24),
});
store.payments[deliveredUnpaid.id] = 'NONE';

// Already paid — tapping this one in Trip History should bounce straight through the
// payment screen to feedback, with no "pay now" button ever shown.
const deliveredPaid = makeBooking({
  status: 'DELIVERED',
  driverId: 'd2',
  actualFare: 980,
  pickupAddress: 'Aluva, Ernakulam, Kerala',
  dropAddress: 'Angamaly, Ernakulam, Kerala',
  distanceKm: 18.4,
  createdAt: minutesAgo(60 * 52),
  completedAt: minutesAgo(60 * 50),
});
store.payments[deliveredPaid.id] = 'PAID';

store.bookings.push(deliveredUnpaid, deliveredPaid);

const find = (id: string) => store.bookings.find((b) => b.id === id);
const pin = () => String(Math.floor(1000 + Math.random() * 9000));

/** Which PIN is live at each stage, mirroring the server's trip-stage table. */
const STAGE_FIELD: Record<string, 'pickupOtp' | 'startOtp' | 'dropOtp'> = {
  ARRIVED_AT_PICKUP: 'pickupOtp',
  LOADING: 'startOtp',
  ARRIVED_AT_DROP: 'dropOtp',
};

/**
 * Advances a demo trip one step on a timer, so the viewer can watch the status card and
 * PIN cards change without needing the driver app open alongside.
 */
const NEXT_STATUS: Record<string, string> = {
  ACCEPTED: 'EN_ROUTE_TO_PICKUP',
  EN_ROUTE_TO_PICKUP: 'ARRIVED_AT_PICKUP',
  ARRIVED_AT_PICKUP: 'LOADING',
  LOADING: 'IN_TRANSIT',
  IN_TRANSIT: 'ARRIVED_AT_DROP',
  ARRIVED_AT_DROP: 'UNLOADING',
  UNLOADING: 'DELIVERED',
};

const statusListeners = new Set<(s: string) => void>();
const otpListeners = new Set<(p: { otp: string; stage: string }) => void>();
const locationListeners = new Set<(l: { lat: number; lng: number; heading?: number }) => void>();
const paymentListeners = new Set<(p: { bookingId: string; status: string }) => void>();

export function advanceDemoTrip(bookingId: string) {
  const b = find(bookingId);
  if (!b) return;
  const next = NEXT_STATUS[b.status];
  if (!next) return;

  b.status = next;
  const field = STAGE_FIELD[next];
  if (field) {
    b[field] = pin();
    otpListeners.forEach((fn) => fn({ otp: b[field], stage: field.replace('Otp', '') }));
  }
  statusListeners.forEach((fn) => fn(next));
}

/* -------------------------------------------------------------------------- */
/* Fake socket                                                                 */
/* -------------------------------------------------------------------------- */

let truckTimer: ReturnType<typeof setInterval> | null = null;

/** Walks the truck along the demo route so the live map actually moves. */
function startTruck() {
  if (truckTimer) return;
  let t = 0;
  truckTimer = setInterval(() => {
    t = (t + 0.02) % 1;
    // Straight interpolation between the two endpoints is enough to show motion and
    // heading; the drawn route line still comes from the real encoded polyline.
    const lat = 9.9679 + (10.5276 - 9.9679) * t;
    const lng = 76.2444 + (76.2144 - 76.2444) * t;
    locationListeners.forEach((fn) => fn({ lat, lng, heading: 350 }));
  }, 2000);
}

export const demoSocket = {
  connected: true,
  id: 'demo-socket',
  emit() {
    /* no-op: nothing to send anywhere in demo mode */
  },
  on(event: string, handler: any) {
    if (event === 'trip:status') statusListeners.add(handler);
    if (event === 'trip:otp') otpListeners.add(handler);
    if (event === 'payment:update') paymentListeners.add(handler);
    if (event === 'trip:location') {
      locationListeners.add(handler);
      startTruck();
    }
    return demoSocket;
  },
  off(event: string, handler: any) {
    statusListeners.delete(handler);
    otpListeners.delete(handler);
    locationListeners.delete(handler);
    paymentListeners.delete(handler);
    return demoSocket;
  },
  disconnect() {
    return demoSocket;
  },
};

/* -------------------------------------------------------------------------- */
/* Fake API                                                                    */
/* -------------------------------------------------------------------------- */

export async function demoFetch<T>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  // A touch of latency so loading states are visible rather than flashing past.
  await new Promise((r) => setTimeout(r, 180));

  const method = opts.method ?? 'GET';
  const body = (opts.body ?? {}) as Json;
  const url = path.split('?')[0];

  const reply = <R>(v: R): R => v;

  // --- auth -------------------------------------------------------------------
  if (url === '/users/me') return reply({ user: store.user }) as T;
  if (url === '/auth/login') return reply({ user: store.user, accessToken: 'demo', refreshToken: 'demo' }) as T;
  if (url === '/auth/request-otp') return reply({ message: 'Code sent' }) as T;
  if (url === '/auth/verify-otp') return reply({ verified: true, verificationToken: 'demo' }) as T;
  if (url.startsWith('/auth/')) return reply({ ok: true }) as T;

  // --- bookings ---------------------------------------------------------------
  if (url === '/bookings/estimate') {
    return reply({ distanceKm: 74.3, durationMin: 85, fare: { total: 1566 }, polyline: DEMO_ROUTE }) as T;
  }
  if (url === '/bookings' && method === 'POST') {
    const b = makeBooking({
      pickupAddress: body.pickup?.address ?? 'Pickup',
      pickupLat: body.pickup?.lat ?? 9.9679,
      pickupLng: body.pickup?.lng ?? 76.2444,
      dropAddress: body.drop?.address ?? 'Drop-off',
      dropLat: body.drop?.lat ?? 10.5276,
      dropLng: body.drop?.lng ?? 76.2144,
      vehicleType: body.vehicleType ?? 'tataAce',
      goodsType: body.goodsType ?? null,
      weightTons: body.weightTons ?? null,
    });
    store.bookings.unshift(b);
    // Two drivers bid a moment later, so the offers list fills in while you watch.
    store.bids[b.id] = [];
    setTimeout(() => {
      store.bids[b.id] = [
        { id: `${b.id}-bid1`, amount: b.estimatedFare, note: 'Empty truck nearby.', status: 'PENDING', createdAt: now(), driver: { id: 'd1', fullName: 'Rajesh Kumar', ratingAvg: 4.8, ratingCount: 124, vehicleType: b.vehicleType, vehicleNumber: 'KL 07 AB 1234' } },
        { id: `${b.id}-bid2`, amount: b.estimatedFare + 160, note: 'Covered truck, tarpaulin included.', status: 'PENDING', createdAt: now(), driver: { id: 'd2', fullName: 'Suresh Nair', ratingAvg: 4.9, ratingCount: 302, vehicleType: b.vehicleType, vehicleNumber: 'KL 11 CD 5678' } },
      ];
    }, 2500);
    return reply({ booking: b }) as T;
  }
  if (url === '/bookings') return reply({ bookings: store.bookings }) as T;

  const bidsMatch = url.match(/^\/bookings\/([^/]+)\/bids$/);
  if (bidsMatch) return reply({ bids: store.bids[bidsMatch[1]] ?? [] }) as T;

  const acceptMatch = url.match(/^\/bookings\/([^/]+)\/bids\/([^/]+)\/accept$/);
  if (acceptMatch) {
    const b = find(acceptMatch[1]);
    const bid = (store.bids[acceptMatch[1]] ?? []).find((x) => x.id === acceptMatch[2]);
    if (b && bid) {
      b.status = 'ACCEPTED';
      b.driverId = bid.driver.id;
      b.actualFare = bid.amount;
      store.bids[b.id] = [];
      // Then it drives itself through the rest of the trip so every stage can be seen.
      let delay = 4000;
      ['EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP'].forEach(() => {
        setTimeout(() => advanceDemoTrip(b.id), delay);
        delay += 6000;
      });
    }
    return reply({ booking: b }) as T;
  }

  const idMatch = url.match(/^\/bookings\/([^/]+)$/);
  if (idMatch) {
    const b = find(idMatch[1]) ?? store.bookings[0];
    return reply({ booking: b }) as T;
  }

  // --- trips ------------------------------------------------------------------
  const etaMatch = url.match(/^\/trips\/([^/]+)\/eta$/);
  if (etaMatch) {
    const b = find(etaMatch[1]);
    const preDrop = ['ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING'].includes(b?.status ?? '');
    // Cycles through real towns along the Kochi -> Thrissur corridor so the place name
    // visibly changes as the demo trip progresses.
    const CORRIDOR = ['Kalamassery', 'Aluva', 'Angamaly', 'Chalakudy', 'Pudukad'];
    const nearPlace = CORRIDOR[Math.floor(Date.now() / 15000) % CORRIDOR.length];
    return reply({ target: preDrop ? 'pickup' : 'drop', etaMinutes: preDrop ? 12 : 48, distanceKm: preDrop ? 6.2 : 41.8, polyline: DEMO_ROUTE, nearPlace, stale: false }) as T;
  }
  if (url.match(/^\/trips\/([^/]+)\/location$/)) {
    return reply({ lat: 10.14, lng: 76.21, ts: now() }) as T;
  }
  const resendMatch = url.match(/^\/trips\/([^/]+)\/resend-otp$/);
  if (resendMatch) {
    const b = find(resendMatch[1]);
    const field = b && STAGE_FIELD[b.status];
    if (b && field) {
      b[field] = pin();
      otpListeners.forEach((fn) => fn({ otp: b[field], stage: field.replace('Otp', '') }));
    }
    return reply({ message: 'Code resent' }) as T;
  }
  if (url.match(/^\/trips\/([^/]+)\/cancel$/)) {
    const b = find(url.split('/')[2]);
    if (b) b.status = 'CANCELLED';
    return reply({ booking: b }) as T;
  }
  if (url.match(/^\/trips\/([^/]+)\/cancellation-policy$/)) {
    return reply({ secondsRemaining: 420, windowEndsAt: new Date(Date.now() + 420_000).toISOString() }) as T;
  }

  // --- misc -------------------------------------------------------------------
  if (url === '/notifications') return reply({ notifications: store.notifications }) as T;
  if (url.startsWith('/notifications')) {
    store.notifications = store.notifications.map((n) => ({ ...n, isRead: true }));
    return reply({ ok: true }) as T;
  }
  if (url === '/ratings') return reply({ ok: true }) as T;

  // --- places (address autocomplete) -------------------------------------------
  // The real backend proxies Nominatim/Google (backend/src/lib/places.ts); demo mode
  // can't reach either, so a small fixed list of Kerala places stands in. Without this,
  // typing in the Book screen's address field while EXPO_PUBLIC_DEMO=1 would crash on
  // `undefined.suggestions` the moment AddressAutocomplete calls this endpoint.
  const PLACE_BOOK: { name: string; area: string; lat: number; lng: number }[] = [
    { name: 'Kochi', area: 'Ernakulam, Kerala', lat: 9.9679, lng: 76.2444 },
    { name: 'Marine Drive', area: 'Kochi, Ernakulam, Kerala', lat: 9.9707, lng: 76.2762 },
    { name: 'Kakkanad', area: 'Ernakulam, Kerala', lat: 10.0159, lng: 76.3419 },
    { name: 'Aluva', area: 'Ernakulam, Kerala', lat: 10.1081, lng: 76.3516 },
    { name: 'Angamaly', area: 'Ernakulam, Kerala', lat: 10.1959, lng: 76.3859 },
    { name: 'Chalakudy', area: 'Thrissur, Kerala', lat: 10.3072, lng: 76.3356 },
    { name: 'Thrissur', area: 'Kerala', lat: 10.5276, lng: 76.2144 },
    { name: 'Swaraj Round', area: 'Thrissur, Kerala', lat: 10.5192, lng: 76.2141 },
    { name: 'Kozhikode', area: 'Kerala', lat: 11.2588, lng: 75.7804 },
    { name: 'Kollam', area: 'Kerala', lat: 8.8932, lng: 76.6141 },
  ];

  if (url === '/places/autocomplete') {
    const q = (new URLSearchParams(path.split('?')[1] ?? '').get('q') ?? '').toLowerCase();
    const suggestions = q.length < 2
      ? []
      : PLACE_BOOK.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({
          placeId: `demo:${p.lat},${p.lng}`,
          description: `${p.name}, ${p.area}`,
          mainText: p.name,
          secondaryText: p.area,
        }));
    return reply({ suggestions }) as T;
  }
  if (url === '/places/details') {
    const placeId = new URLSearchParams(path.split('?')[1] ?? '').get('placeId') ?? '';
    const m = placeId.match(/^demo:(-?[\d.]+),(-?[\d.]+)$/);
    const [lat, lng] = m ? [Number(m[1]), Number(m[2])] : [9.9679, 76.2444];
    const match = PLACE_BOOK.find((p) => p.lat === lat && p.lng === lng);
    return reply({ address: match ? `${match.name}, ${match.area}` : 'Kochi, Kerala', lat, lng, placeId }) as T;
  }
  if (url === '/places/reverse') {
    return reply({ address: 'Marine Drive, Kochi, Ernakulam, Kerala' }) as T;
  }

  // --- payments -----------------------------------------------------------------
  const orderMatch = url.match(/^\/payments\/([^/]+)\/order$/);
  if (orderMatch) {
    const bookingId = orderMatch[1];
    const b = find(bookingId);
    const amount = (b?.actualFare ?? b?.estimatedFare) ?? 0;
    store.payments[bookingId] = 'PENDING';
    return reply({
      paymentId: `demo-payment-${bookingId}`,
      orderId: `demo_order_${bookingId}`,
      amount,
      currency: 'INR',
      keyId: 'demo_key',
      provider: 'mock',
    }) as T;
  }

  const mockCompleteMatch = url.match(/^\/payments\/([^/]+)\/mock-complete$/);
  if (mockCompleteMatch) {
    const bookingId = mockCompleteMatch[1];
    store.payments[bookingId] = 'PAID';
    paymentListeners.forEach((fn) => fn({ bookingId, status: 'PAID' }));
    return reply({ status: 'PAID' }) as T;
  }

  const paymentStatusMatch = url.match(/^\/payments\/([^/]+)$/);
  if (paymentStatusMatch) {
    const status = store.payments[paymentStatusMatch[1]] ?? 'NONE';
    return reply({ status }) as T;
  }

  return reply({} as any) as T;
}
