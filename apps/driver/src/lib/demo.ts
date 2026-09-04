/**
 * Demo mode — runs the whole driver app with no backend and no database.
 *
 * Enabled with EXPO_PUBLIC_DEMO=1. Every `apiFetch` is served from the in-memory store
 * below instead of the network, and the socket is replaced by a local emitter.
 *
 * The store is deliberately MUTABLE: going online, bidding, verifying PINs and advancing
 * the trip all change state, so the flow actually progresses. A read-only mock would look
 * like a broken app the moment you tapped anything.
 *
 * This is for looking at the UI. It is not a test double for the API contract — the real
 * server remains the only thing that decides what is true.
 */

export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';

type Json = Record<string, any>;

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const DEMO_ROUTE =
  'kzy{@onjpMQA_B@SC?OHw@DOFOs@McVTyAJu@FoCh@IDCDAH?FDLLZVr@?NCBGFCBQHSHOFMHEBMJYTA@GDIJMRc@x@KRGJGHYX[T{AdAKHa@Zy@l@a@VGDIDWJ_@LYHa@LODOBm@JA?oAT_@HG@g@Ja@BM@M@YAmAAmAES?iFIg@?O?eA?[?G?s@AE?[?OBg@CEBE@G?KEg@Ds@BiB?yAAG@U?c@DkAP}@LSDsARQB{Bd@WDaBVODe@H]FmAXsAZWFmBf@qBf@eATe@NaAVy@RmDv@aB\i@JUF[P[Tq@^m@Ti@Dg@R]Fi@H]JQFa@P_@Lg@N{Bt@a@NeA\UFaBh@IB{A^yAj@[JiCz@oCx@k@TYH{Bn@iA\eCr@[JQDE@KDC@o@^gAj@MFIFYNYLg@Ps@VMFq@Tq@Va@NMFq@VQHWLcA`@]LUJYLcAb@_@Lk@Ry@X}@Xg@NeA`@MFyAl@]HUF_@Hc@HYH[HUH_@LcA`@y@\UJq@XKDoAl@eAf@qBr@SHk@L]JWJu@^sAp@{@`@m@V}@b@SJs@ZSJw@XiAb@WLKDSJIDIFWNGB_@VOH}@f@[PQJw@^YLoCbAa@LMFuFlBeA^iA`@}@X_@L]L{@VqBl@_AZcA\y@\UHODe@JE?a@FkBTuAPOBG@oBZ_BXsATSD}@NOBOBc@FwBVG?I@i@H_@DGB_A\gA`@c@J_ATYFqCn@KBaATmCn@qAVUD{@XuBd@q@Nk@Jc@Jk@LmAT]H}A\m@Nm@NI@{Bd@kATk@JODuCh@sB\kATKBMBc@Jg@LQD_@Ja@FUFm@LQBcEt@q@LeB\UDuB^m@Lq@LeCd@qAVy@LkAL_@DaALg@JiFdA[HUFC?y@Ps@NuAVYFoAT}@N{Bb@oAVMB_APWDc@@YBYD[B_@Fa@HyB\}@HoC^wAX{Cn@yBjAiBd@[JWFiDz@m@JsA@YAoCWKA_@A[Be@BcALgAFw@As@Ju@Ny@T_@Ju@Tw@TyAf@w@Ti@Ly@Vy@Ve@Lk@Lc@Dy@Bk@B[DmANuANq@Jc@JE@m@Nq@Pm@NGBe@HMDg@Lo@H_@Da@@M@o@B_@@Q@K@iABe@?G?s@Dk@Du@Di@@aBDa@@_@DSBW@UBm@Jy@JI@cALqCb@eANE@c@Fa@HyATg@Fo@FM@{DVmAF{APoBLa@Bk@As@A_BLI?UBe@DoAHeBT{ARQBcANA?c@Hi@Ju@LQBC@s@JqANc@F{@NiALoBZqBVYBi@JkAPkALE?SDWB[Bs@La@Fc@FG@WBk@Le@FgANm@Ho@PYD}B^q@JkALy@Hq@Hs@Jy@La@DSBo@JQ@_@Da@F_@HqBZgB\a@FaC^u@N]DwATsANk@FG@gATa@HWD_BT{@Ne@HmBV_C`@}Bb@g@He@JmB\o@NaAPWFOHaAPq@Ra@HqAV}AP{@VKBmARkATQDc@HeAPgARo@Ju@N}@V{AVKBs@LKBgAT{@N}A\_@H]H_@FaAPg@J]HOBa@F}@Nk@N[FE@[Hw@LiAT[FI@[B{@Hs@Hy@Js@Nk@DaBVqARmATG@_BVeAP_@DODIHEHAN?JAVCPGLCBIBIB{AZQDu@PUBI@KEECGM?IIg@EOIGGCKASAqBLWB[ByANkCTM@SBk@J_@JSDk@NeA\o@Ta@LcBn@wA\iAVOBiBb@k@Lq@PKBeAX[FmA\kAXy@ZE@IBa@Jc@FKBUBm@Ha@FgANaB\_@Hi@JOB}AZaB^EBQD_@Hm@H{@Js@H}@Hs@FkAH_AFi@?gB?w@Bw@Ji@FK@qBVSDqARqAV_@Hw@PwAZgARA@iARK@e@Ja@Dq@HOBgAPs@NqAVc@Lc@P_@Ly@Zs@Vq@VEB_A\[HKDYJSFSDYB_ANYDE?_@Fk@HiAHe@D[Du@F_BJaAHYDOB]HUHa@NWHcBp@[Js@TMFy@Tq@P}Ad@_@HiATKBk@Jm@Hk@JYDE@]DYBSDC?K@GBu@NC@aAL[Dk@FcAR}@P}@PcAPe@JgB^}@TG@a@Jg@NQDGBEDEFCHAJ?~BARAJGHGDSHKByA`@_@Lq@PqAZ_@JE?]HwA`@s@Ti@Ny@R]Li@RIBaA\c@J_@Lo@Pm@NOFw@NG@y@Le@@]CYQQOIGEAI?U@WDWDQDiB\i@HUDi@LIB{@X[J{A`@QBuAVaCd@w@Tq@Ru@\e@VUPWVONa@`@u@f@i@TID_@Ju@RkATg@HeATQDODy@Ra@Pm@\aAh@m@\mCzAk@Za@VcBhAo@h@YVqBzAk@\_CxAeB|@OFuBt@[JmAZg@Ny@TYJ_AVYFmB`@eAj@cBrAMJcCpAWLKFmA^a@LMB[HyCv@eATWFoA\gAZE@cBn@qBr@EB}Ah@SPa@`BUdBRp@x@nBHPAZMJcA^qAb@QFQFE@KUQa@s@kA{AwBsGcKw@cAeAkAUScAm@g@Qa@CsAH[JKDu@fBUd@]f@]\k@`@eCrAMDSDm@FK?g@?e@DaBVc@Dq@E[M]]GGw@_BGOwC}Bi@sAIi@COAm@CUe@mFI_AE]CGEEO[W_@{AgCe@w@S{@QuAAG_@wCK}@AIKkA@e@DkCBmB?a@Am@?YCmA?_@AoB@aA@k@[Ug@Oe@IaAYSQIQE]?GMwEK]SK_@Ag@Qs@oAaAgAEIu@{AO][cBw@mA]cAAIu@eESuByAmAy@q@SQaAo@[e@Mm@[s@g@mACG]wAc@g@]q@MwAeA_BMm@??CQaAN{@@cFRmCLsFTaHViDT_DLsAFc@BwBNmBHc@ByBLoAFwCL_Ib@cADM?i@BgC`@WFcAFyAJc@ByCJ{@BuADmEDyA?aA@}@@iBHwAJiAN{ATkATeCl@uBd@iBb@oA^cBZeCl@_@JG@k@Pq@ReCh@aCj@sDbAsAZ{Ab@y@VwAd@qA`@uAZuAVgEh@oCP}CRa@Bs@BoA?uCHaC?sB?gCCgA?aC@{C@{@@Q?Y@c@Dc@BgD\qCXUR}@D_ADaBBsBBgA@Y?uALiD\gEl@}Bj@m@NaBj@yCt@cAV{@RaEbAcDn@_D|@wBl@cD~@kBd@k@N{A^kCbAu@\}@f@oAl@m@X]P{@b@wBx@cExAqEzAiCz@kBn@cBn@uClAoExBeIhDwBv@sAl@a@Vc@XcBt@uEjBgBn@s@X]JYHWHmAViF~@oEt@yE|@cBZu@\mAj@eAl@_Al@iAt@gAp@eCxAm@\_Bv@kChAuAj@aA\oGpB{Cz@i@RwAb@oCfA_CzAoCfBo@^{BvAgClA]NwAnAe@d@q@bA_@d@mA|AqBjBWPmC|Be@h@}@bAeCxDW`@o@l@}@n@GBy@^c@JWDoANmAL[J?XEp@Cl@EJOFsBTyCToA@[AuACc@@]Gk@OQGi@SKCo@OWA_AAe@?C?wANc@NoBr@Q@qB`@uAVeAHWBgABqA?_@?o@?k@DkAFyBZe@H_AN}ATg@TYNaAn@UTc@`@GD}@r@}@bAIBIFKDa@R_Ab@MD}@b@k@^e@d@[^a@f@[ZoBdB]ZGJEDW^U\s@n@w@l@_@`@[l@_@`AId@SJIEa@cAQc@q@yAGQwEaGiB{BqCkD}AiBe@m@m@y@[qAEgAVu@BaAKqAiAoFYyAOWs@mA_AoBmCiE[_@Yw@CuA]{C]aCKiAU_BAIEUUwBFsBE_CRyAJo@Ny@?mBIsAC_@OkBq@sB[gADYFQ^]BCp@UPEtAa@JCn@O~@Q^OHUBgAYeBAKa@eE_AaHEYM}@]wBe@eDm@gEQwAK[YsCY{BQwBCYq@gEm@{C}@qGA_@I}CEo@AYMkCMmBWgBCWSsBYkBEe@Ig@EeAAi@AEEIEKQSKYGUAI?g@B_@Be@Da@BYDy@@q@C]AOC]?[Ae@@i@Ba@B[@KFa@BWDg@BgA?kAGyAGgACaBGiAA_A?g@C[AOAcAGm@Ig@I]Im@O}@G_@US_@]k@k@SSa@u@q@gCOi@WaAEUCIOs@Gc@Eo@?e@@c@@_@As@?e@C_@Ga@Gm@K_AQ}@Qm@Oa@m@_Ba@iAWm@GSe@{ACGWq@K_@]kAmBDaABqE@S?QC{A[uMiCw@M[EuEi@g@Cs@AM?oAAqMZkAD_BF]@oBLcBH[Bc@B{ALsALsAReDj@IBg@F}G|@kANy@HOBQ?uBPaADM?]@}ADuA?cB?e@BgFViAJyBXi@Ji@RQNGT?b@Jd@Rt@@d@@PIJmAl@wDhAa@HYBmCLoAFiADq@BuDJw@Dm@BoBDoACSAoEI_@AwACyBE[AiKUOAgAEmAGi@AcCOcDSuAIGAmDSsBOg@GkAM[CoDYeCKg@C}DUG?aEMUA_DSg@G}B_@aCSiE]sFw@aEk@YEkI{@UC_@EaGe@iE]s@G]CwFg@}AGy@Ay@DyCR{@HaAFiA@_A@cAAu@Cm@A}BGQ?i@CO?oBGeBIwDOK?WAsDQeBMmAIaBM_AKq@Eo@I{A]k@MkBo@cGeCeAa@q@WyCw@IAoAKuDSu@FY@{AJwDd@UDsNnDQDi@J}Bh@u@Da@@i@?{@C{A?y@CgAE}AUgBUYCcI}@s@M{Ci@GAkASkAMG?gAM_CQG?eHQy@?wEHsLp@G?Q@g@Bi@BI@uAJi@DgARaH~@{C^g@FqC^yALmA?[CWA]?w@Cw@IgBYSAKBULaDzAc@LoAV_Cd@cCVSDQHSNmAfBEHgApBw@`Bi@vAk@xAIJMBI@_@CqD[U?K@MDk@b@_Ap@wCdCMJWRkAj@[JkBf@wATqAFS@mCLc@BWBk@@gERcBH_ADaA@u@@cBD]B}D`@o@DeBDkAJa@Du@DgBLaQjAaAFsETsEIcAMi@GyB}@W[{AsAa@YmA}@{@k@gAu@YUICaAY]KaAYmBm@aBUa@Co@EgBI{@E]CuBUcCU_Da@]AqC{@a@MyBc@kAEe@Fe@DsAJq@DgFQaFUKAmAGe@IgA{@aAk@a@_@UMyAo@MESE]KeDAeFGk@AkCE_@?iBEU?k@?e@EYC]CWEg@CMZq@bBy@dBuAxCm@lAKTcAlBYf@EHOT[b@}AnB_AhAm@r@e@f@k@p@qAbDkAlCc@`AYr@Sh@[`AGPUx@cAZqBZiAFQBw@FM@eAJaBLcAP_@H]LyAb@KDmAZUF_@HM@e@DeAF_@?aAAu@Eg@ASAk@@oAHmBNcA?y@GqAQeAM}@GyAGC?}@CkDAgCFo@D{@FaB@cD?wBEE?W?_AOo@Qq@OOEu@MuB[c@S}Ai@sA_@YIw@Uu@Qk@Se@Om@QQCiAMGAi@G{BWk@GiAGeBQuCIgBG}CMSAaAEwAAk@CWC_@E]KmBg@WIw@WIEgAc@g@U}@Y_@MmAe@e@OoAa@e@MiEwAeDgAQMMQEMu@mBMQOKQEq@@kD?g@CaBSm@Io@Kq@KSEuASSEsCc@{AQgAM}AWa@C[Am@Bo@FaB\}Bn@y@P{Bb@oBp@YJq@@}BQe@K_@Io@QqAWi@Ge@CmAL[H]LSHSJ_@ZiBbBQDs@@o@D]H_@RMHy@h@g@\YRa@NODa@@gABU?iAIg@Eu@GgD_@qBKc@CwB@G@eBJS@Q@YBiCb@gAL_@F{E\qAHe@DwAJ{BJe@D[BU@W@u@FS@q@FWBC?m@JIBI@SL_@FWDi@FwB\a@HWDq@PU@SFEBeA\WF_@Ha@DA?y@Fm@DiAF[@kBD_@@m@@w@D{@BoBJi@@c@Aw@Bc@?m@Ea@A_@?{@BE?e@@e@@M?S?}@EMAM?W@YDYFOBe@@k@EQASASCWCMASAe@EI?M@Y@WD]FWF_@La@Jm@Rg@JI@a@HQDSBM?O@_@@M?OA]C[Eo@Is@KgAUu@Uo@Sc@IKCSCUGi@KcAMc@?eAA]Gs@OcAQDp@?n@?V?nB@T@^Bd@@DAD?DAFCBADEDEDE@GBG@i@?IAgAAoBA[?MGEMCU?]EmBCe@KwBiAByAC{@BwBC}AIuAKICGGEKAW?k@CMOK]EcADC?U@a@?i@Co@Kc@H[He@FE?WBq@@I?e@AK?[A]?cC?aA?cA@]?_@E_@MQK_@MWc@EGg@_B[cAOg@Uq@q@mBUE';

let seq = 1;
const nextId = () => `demo-${seq++}`;
const pin = () => String(Math.floor(1000 + Math.random() * 9000));

function makeBooking(over: Json = {}): Json {
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
    distanceKm: 74.3,
    durationMin: 85,
    estimatedFare: 1566,
    actualFare: null,
    routePolyline: DEMO_ROUTE,
    pickupOtp: null,
    startOtp: null,
    dropOtp: null,
    myBid: null,
    createdAt: now(),
    ...over,
  };
}

/** The one knob for previewing the dashboard's three verification states. */
const DEMO_VERIFICATION: 'APPROVED' | 'PENDING' | 'IN_REVIEW' | 'REJECTED' | 'EXPIRED' | 'SUSPENDED' =
  'APPROVED';

const store = {
  user: {
    id: 'demo-driver',
    role: 'DRIVER' as const,
    fullName: 'Rajesh Kumar',
    phone: '9876501234',
    email: 'rajesh@example.in',
    driverProfile: {
      vehicleType: 'tataAce' as const,
      vehicleNumber: 'KL 07 AB 1234',
      drivingLicenseNumber: 'KL0120110012345' as string | null,
      isOnline: false,
      ratingAvg: 4.8,
      ratingCount: 124,
      // Flip this to preview the other two dashboard states: 'PENDING' shows the KYC gate
      // and hides the load sheet, 'REJECTED' shows the action-needed wording.
      verificationStatus: DEMO_VERIFICATION,
      rejectionReason: null as string | null,
    },
  },
  // Open requests on the board, plus the driver's active trip once one is accepted.
  feed: [
    makeBooking(),
    makeBooking({
      pickupAddress: 'Aluva Metro, Ernakulam, Kerala',
      dropAddress: 'Angamaly, Ernakulam, Kerala',
      distanceKm: 18.4,
      durationMin: 32,
      estimatedFare: 640,
      goodsType: 'Cement bags',
      weightTons: 3,
    }),
    makeBooking({
      pickupAddress: 'Kalamassery, Ernakulam, Kerala',
      dropAddress: 'Perumbavoor, Ernakulam, Kerala',
      distanceKm: 24.1,
      durationMin: 41,
      estimatedFare: 780,
      goodsType: 'Timber',
      weightTons: 4,
    }),
  ] as Json[],
  active: null as Json | null,
  // Spread across the last week with uneven amounts and one empty day — a flat set of
  // fares makes the bar chart look identical whether it works or not.
  completed: [
    { id: 'c1', reference: 'TRK-9K2M04', dropAddress: 'Thrissur, Kerala', completedAt: minutesAgo(60 * 3), actualFare: 1350, estimatedFare: 1300, paymentStatus: 'PAID' },
    { id: 'c2', reference: 'TRK-7B4X19', dropAddress: 'Angamaly, Ernakulam', completedAt: minutesAgo(60 * 26), actualFare: 640, estimatedFare: 620, paymentStatus: 'PAID' },
    { id: 'c3', reference: 'TRK-3P8Q57', dropAddress: 'Perumbavoor, Ernakulam', completedAt: minutesAgo(60 * 30), actualFare: 1200, estimatedFare: 1200, paymentStatus: 'PENDING' },
    { id: 'c4', reference: 'TRK-5N1D63', dropAddress: 'Aluva, Ernakulam', completedAt: minutesAgo(60 * 74), actualFare: 980, estimatedFare: 950, paymentStatus: 'PAID' },
    // Day five is deliberately empty.
    { id: 'c5', reference: 'TRK-2F6H82', dropAddress: 'Kalamassery, Ernakulam', completedAt: minutesAgo(60 * 122), actualFare: 1520, estimatedFare: 1480, paymentStatus: 'PAID' },
    { id: 'c6', reference: 'TRK-8L3R45', dropAddress: 'Kochi, Ernakulam', completedAt: minutesAgo(60 * 146), actualFare: 720, estimatedFare: 700, paymentStatus: 'FAILED' },
  ],
  // The Rides tab's own list: a mix of states so the filters and search have something
  // to actually discriminate between.
  history: [
    makeBooking({ reference: 'TRK-9K2M04', status: 'DELIVERED', pickupAddress: 'Kochi, Ernakulam, Kerala', dropAddress: 'Thrissur, Kerala', distanceKm: 74.3, estimatedFare: 1300, actualFare: 1350 }),
    makeBooking({ reference: 'TRK-7B4X19', status: 'DELIVERED', pickupAddress: 'Aluva Metro, Ernakulam', dropAddress: 'Angamaly, Ernakulam', distanceKm: 18.4, estimatedFare: 620, actualFare: 640 }),
    makeBooking({ reference: 'TRK-4T7W28', status: 'IN_TRANSIT', pickupAddress: 'Edappally, Ernakulam', dropAddress: 'Kottayam, Kerala', distanceKm: 62.0, estimatedFare: 1180, actualFare: null }),
    makeBooking({ reference: 'TRK-6Y2C91', status: 'ACCEPTED', pickupAddress: 'Vyttila, Ernakulam', dropAddress: 'Alappuzha, Kerala', distanceKm: 54.2, estimatedFare: 1050, actualFare: null }),
    makeBooking({ reference: 'TRK-1A5S36', status: 'CANCELLED', pickupAddress: 'Fort Kochi, Ernakulam', dropAddress: 'Munnar, Idukki', distanceKm: 130.5, estimatedFare: 2400, actualFare: null }),
    makeBooking({ reference: 'TRK-8L3R45', status: 'DELIVERED', pickupAddress: 'Palarivattom, Ernakulam', dropAddress: 'Kochi, Ernakulam', distanceKm: 9.8, estimatedFare: 700, actualFare: 720 }),
  ] as Json[],
  notifications: [
    { id: 'n1', title: "You're approved", body: 'Your documents were verified. You can go online and start accepting trips.', isRead: false, createdAt: minutesAgo(15) },
    { id: 'n2', title: 'Bid accepted', body: 'Arun Menon accepted your ₹1,566 offer for the Kochi shipment.', isRead: false, createdAt: minutesAgo(40) },
    { id: 'n3', title: 'Payout processed', body: '₹3,530 was transferred to your account ending 4421.', isRead: true, createdAt: minutesAgo(60 * 20) },
  ],
  documents: [
    { type: 'DRIVING_LICENSE', required: true, status: 'APPROVED', number: 'KL0120110012345', expiresAt: new Date(Date.now() + 3 * 365 * 86400_000).toISOString(), rejectionReason: null, hasFile: true, documentId: 'doc1' },
    { type: 'VEHICLE_RC', required: true, status: 'APPROVED', number: 'KL07AB1234', expiresAt: null, rejectionReason: null, hasFile: true, documentId: 'doc2' },
    { type: 'INSURANCE', required: true, status: 'APPROVED', number: null, expiresAt: new Date(Date.now() + 200 * 86400_000).toISOString(), rejectionReason: null, hasFile: true, documentId: 'doc3' },
    { type: 'FITNESS_CERTIFICATE', required: true, status: 'APPROVED', number: null, expiresAt: new Date(Date.now() + 140 * 86400_000).toISOString(), rejectionReason: null, hasFile: true, documentId: 'doc4' },
    { type: 'PERMIT', required: true, status: 'APPROVED', number: null, expiresAt: new Date(Date.now() + 500 * 86400_000).toISOString(), rejectionReason: null, hasFile: true, documentId: 'doc5' },
  ],
};

const STAGE_FIELD: Record<string, 'pickupOtp' | 'startOtp' | 'dropOtp'> = {
  ARRIVED_AT_PICKUP: 'pickupOtp',
  LOADING: 'startOtp',
  ARRIVED_AT_DROP: 'dropOtp',
};

const DRIVER_NEXT: Record<string, string> = {
  ACCEPTED: 'EN_ROUTE_TO_PICKUP',
  EN_ROUTE_TO_PICKUP: 'ARRIVED_AT_PICKUP',
  IN_TRANSIT: 'ARRIVED_AT_DROP',
  UNLOADING: 'DELIVERED',
};

const VERIFY_NEXT: Record<string, string> = {
  ARRIVED_AT_PICKUP: 'LOADING',
  LOADING: 'IN_TRANSIT',
  ARRIVED_AT_DROP: 'UNLOADING',
};

const statusListeners = new Set<(s: any) => void>();
const locationListeners = new Set<(l: any) => void>();
const bidAcceptedListeners = new Set<(p: any) => void>();

const loadNewListeners = new Set<(payload: any) => void>();
const loadTakenListeners = new Set<(payload: any) => void>();

/**
 * Fires a synthetic load offer a few seconds after something first subscribes, so the
 * popup — which is the whole point of dispatch — can be seen without a backend, a second
 * device, or a real push credential.
 */
let demoLoadTimer: ReturnType<typeof setTimeout> | null = null;
const DEMO_LOAD_DELAY_MS = 6000;

function scheduleDemoLoad() {
  if (demoLoadTimer || loadNewListeners.size === 0) return;
  demoLoadTimer = setTimeout(() => {
    demoLoadTimer = null;
    const offer = store.feed[0];
    if (!offer) return;
    const payload = {
      bookingId: offer.id,
      reference: offer.reference,
      pickupAddress: offer.pickupAddress,
      dropAddress: offer.dropAddress,
      vehicleType: offer.vehicleType,
      distanceKm: offer.distanceKm,
      estimatedFare: offer.estimatedFare,
    };
    loadNewListeners.forEach((fn) => fn(payload));
  }, DEMO_LOAD_DELAY_MS);
}

export const demoSocket = {
  connected: true,
  id: 'demo-socket',
  emit() {
    /* no-op: nothing to send anywhere in demo mode */
  },
  on(event: string, handler: any) {
    if (event === 'trip:status') statusListeners.add(handler);
    if (event === 'trip:location') locationListeners.add(handler);
    if (event === 'bid:accepted') bidAcceptedListeners.add(handler);
    if (event === 'load:new') {
      loadNewListeners.add(handler);
      scheduleDemoLoad();
    }
    if (event === 'load:taken') loadTakenListeners.add(handler);
    return demoSocket;
  },
  off(_event: string, handler: any) {
    statusListeners.delete(handler);
    locationListeners.delete(handler);
    bidAcceptedListeners.delete(handler);
    loadNewListeners.delete(handler);
    loadTakenListeners.delete(handler);
    return demoSocket;
  },
  disconnect() {
    if (demoLoadTimer) {
      clearTimeout(demoLoadTimer);
      demoLoadTimer = null;
    }
    return demoSocket;
  },
};

/**
 * The PIN the customer would be reading off their screen. In demo mode there is no second
 * device, so the driver screen surfaces it — see the hint in trip/[id].tsx.
 */
export function currentDemoPin(): string | null {
  const b = store.active;
  if (!b) return null;
  const field = STAGE_FIELD[b.status];
  return field ? b[field] : null;
}

export async function demoFetch<T>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 180));

  const method = opts.method ?? 'GET';
  const body = (opts.body ?? {}) as Json;
  // The query string used to be thrown away here, which meant the Rides tab's filter and
  // search silently did nothing in the only environment they can be exercised in.
  const [url, queryString] = path.split('?');
  const query = new URLSearchParams(queryString ?? '');
  const reply = <R>(v: R): R => v;

  // --- auth -------------------------------------------------------------------
  if (url === '/drivers/me') return reply({ user: store.user }) as T;
  if (url === '/auth/driver') return reply({ user: store.user, accessToken: 'demo', refreshToken: 'demo' }) as T;
  if (url === '/auth/request-otp') return reply({ message: 'Code sent' }) as T;
  if (url === '/auth/verify-otp') return reply({ verified: true, verificationToken: 'demo' }) as T;
  if (url.startsWith('/auth/')) return reply({ ok: true }) as T;

  // --- going online -----------------------------------------------------------
  if (url === '/drivers/location') {
    if (typeof body.isOnline === 'boolean') store.user.driverProfile.isOnline = body.isOnline;
    return reply(undefined as any) as T;
  }

  // --- dispatch board ---------------------------------------------------------
  if (url === '/bookings/available') return reply({ bookings: store.feed }) as T;

  // Ride history. Without this the Rides tab fell through to the empty catch-all below
  // and rendered "no rides" with no error — a silent blank screen.
  if (url === '/bookings' && method === 'GET') {
    const filter = query.get('filter') ?? 'all';
    const search = (query.get('search') ?? '').toLowerCase();

    const ACTIVE = ['ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'IN_TRANSIT', 'ARRIVED_AT_DROP', 'UNLOADING'];
    const matchesFilter = (b: Json) =>
      filter === 'active'
        ? ACTIVE.includes(b.status)
        : filter === 'completed'
          ? b.status === 'DELIVERED'
          : filter === 'cancelled'
            ? ['CANCELLED', 'REJECTED', 'NO_DRIVER_FOUND'].includes(b.status)
            : true;
    const matchesSearch = (b: Json) =>
      !search ||
      String(b.reference).toLowerCase().includes(search) ||
      String(b.dropAddress).toLowerCase().includes(search);

    const rows = [...(store.active ? [store.active] : []), ...store.history];
    return reply({ bookings: rows.filter((b) => matchesFilter(b) && matchesSearch(b)) }) as T;
  }

  // --- push registration ------------------------------------------------------
  if (url === '/devices/register' || url.startsWith('/devices/')) return reply(undefined as any) as T;

  const bidMatch = url.match(/^\/bookings\/([^/]+)\/bids$/);
  if (bidMatch && method === 'POST') {
    const b = store.feed.find((x) => x.id === bidMatch[1]);
    if (b) {
      b.myBid = { id: `${b.id}-mybid`, amount: body.amount, status: 'PENDING' };
      // The customer accepts a moment later, so the accept -> trip transition is visible.
      setTimeout(() => {
        b.status = 'ACCEPTED';
        b.driverId = store.user.id;
        b.actualFare = body.amount;
        store.active = b;
        store.feed = store.feed.filter((x) => x.id !== b.id);
        statusListeners.forEach((fn) => fn({ status: 'ACCEPTED' }));
        // Mirrors the real server pushing bid:accepted, which is what moves the driver
        // from the dashboard onto the trip screen.
        bidAcceptedListeners.forEach((fn) => fn({ bookingId: b.id }));
      }, 3000);
    }
    return reply({ bid: { id: `${bidMatch[1]}-mybid`, amount: body.amount, status: 'PENDING' } }) as T;
  }
  const withdrawMatch = url.match(/^\/bookings\/([^/]+)\/bids\/([^/]+)$/);
  if (withdrawMatch && method === 'DELETE') {
    const b = store.feed.find((x) => x.id === withdrawMatch[1]);
    if (b) b.myBid = null;
    return reply(undefined as any) as T;
  }

  // --- the active trip --------------------------------------------------------
  const idMatch = url.match(/^\/bookings\/([^/]+)$/);
  if (idMatch) {
    const b = store.active?.id === idMatch[1] ? store.active : store.feed.find((x) => x.id === idMatch[1]) ?? store.active;
    return reply({ booking: b }) as T;
  }

  const statusMatch = url.match(/^\/trips\/([^/]+)\/status$/);
  if (statusMatch) {
    const b = store.active;
    if (b && DRIVER_NEXT[b.status] === body.status) {
      b.status = body.status;
      const field = STAGE_FIELD[b.status];
      if (field) b[field] = pin();
      statusListeners.forEach((fn) => fn({ status: b.status }));
    }
    return reply({ booking: b }) as T;
  }

  const verifyMatch = url.match(/^\/trips\/([^/]+)\/verify-otp$/);
  if (verifyMatch) {
    const b = store.active;
    const field = b && STAGE_FIELD[b.status];
    if (!b || !field) {
      throw Object.assign(new Error("There's no code to enter at this point."), { status: 409, code: 'INVALID_STATE' });
    }
    if (body.otp !== b[field]) {
      // Same shape as a real ApiError so the screen's error handling is exercised.
      throw Object.assign(new Error('That code is wrong.'), { status: 400, code: 'INVALID_OTP' });
    }
    b[field] = null;
    b.status = VERIFY_NEXT[b.status];
    const nextField = STAGE_FIELD[b.status];
    if (nextField) b[nextField] = pin();
    statusListeners.forEach((fn) => fn({ status: b.status }));
    return reply({ booking: b }) as T;
  }

  const etaMatch = url.match(/^\/trips\/([^/]+)\/eta$/);
  if (etaMatch) {
    const b = store.active;
    const preDrop = ['ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING'].includes(b?.status ?? '');
    return reply({ target: preDrop ? 'pickup' : 'drop', etaMinutes: preDrop ? 12 : 48, distanceKm: preDrop ? 6.2 : 41.8, polyline: DEMO_ROUTE, stale: false }) as T;
  }

  // --- everything else --------------------------------------------------------
  if (url === '/drivers/earnings') {
    const total = store.completed.reduce((s, t) => s + (t.actualFare ?? t.estimatedFare ?? 0), 0);
    return reply({ totalEarnings: total, completedTrips: store.completed.length, trips: store.completed }) as T;
  }
  if (url === '/drivers/documents') {
    return reply({
      verificationStatus: store.user.driverProfile.verificationStatus,
      rejectionReason: store.user.driverProfile.rejectionReason,
      approvedAt: now(),
      documents: store.documents,
    }) as T;
  }
  if (url === '/drivers/documents/verify') {
    return reply({ verificationStatus: 'APPROVED', documents: store.documents }) as T;
  }
  if (url === '/drivers/bank-details') {
    return reply({ accountHolderName: 'Rajesh Kumar', bankAccountNumber: '••••••4421', ifscCode: 'HDFC0001234' }) as T;
  }
  if (url === '/notifications') return reply({ notifications: store.notifications }) as T;
  if (url.startsWith('/notifications')) {
    store.notifications = store.notifications.map((n) => ({ ...n, isRead: true }));
    return reply({ ok: true }) as T;
  }
  if (url === '/ratings') return reply({ ok: true }) as T;

  // The driver side never creates or completes a payment — only watches its status — so a
  // plausible default is enough for the completed-ride screen to have something to show.
  if (url.match(/^\/payments\/([^/]+)$/)) {
    return reply({ status: 'PENDING' }) as T;
  }

  return reply({} as any) as T;
}
