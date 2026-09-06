/**
 * Shared test setup.
 *
 * Everything mocked here is a native module with no meaning under Jest: storage, GPS, the
 * camera, push, sockets. The app's own code is never mocked — mocking what you are testing
 * proves only that the mock works.
 *
 * Names begin with `mock` deliberately. Jest hoists `jest.mock` above the imports, so a
 * factory may only close over variables whose names carry that prefix; anything else is a
 * build error rather than a runtime surprise.
 *
 * The jest-native matchers are built into @testing-library/react-native from v12.4 onward,
 * so there is nothing to import for them here.
 */

/**
 * React 19 refuses to batch test updates unless it is told it is in a test environment.
 * Without this every state update from an effect warns and the tree never settles.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ storage */

/**
 * A real in-memory implementation rather than `jest.fn()` stubs.
 *
 * `getNotificationPrefs` merges what it reads over its defaults, so a stub returning
 * undefined would pass tests a real device would fail. This behaves like the thing it
 * replaces, including surviving a write-then-read inside one test.
 */
const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) mockStore.delete(k);
    }),
    clear: jest.fn(async () => mockStore.clear()),
  },
}));

export const testStorage = mockStore;

/* ----------------------------------------------------------------- location */

jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 9.9312, longitude: 76.2673, heading: 0, speed: 0 },
  })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));

/* ------------------------------------------------------------------- pickers */

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

/* --------------------------------------------------------------------- push */

jest.mock('@/lib/push', () => ({
  registerForPush: jest.fn(async () => null),
  unregisterPush: jest.fn(async () => {}),
  addNotificationTapListener: jest.fn(() => () => {}),
  ensureLoadsChannel: jest.fn(async () => {}),
}));

/**
 * Platform, and the one native module that branches on it.
 *
 * The app ships as an Android APK, so Android is what this suite should reason about — but
 * jest-expo's preset resolves as iOS, which sent the documents screen down the
 * ActionSheetIOS path where there is no such native module.
 *
 * Resolution is pinned to Android in the Jest config's `haste` block, which is how the
 * platform is actually chosen — writing to `Platform.OS` from a test does nothing, because
 * it is not a plain writable field.
 *
 * ActionSheetIOS still needs a stand-in: the documents screen references it on the iOS
 * branch, and there is no such native module here.
 */
jest.mock('react-native/Libraries/ActionSheetIOS/ActionSheetIOS', () => ({
  __esModule: true,
  default: { showActionSheetWithOptions: jest.fn() },
  showActionSheetWithOptions: jest.fn(),
}));

/* --------------------------------------------------------------- safe areas */

/**
 * Insets come from the device. Screens read them through `useSafeAreaInsets`, which throws
 * without a provider above it, so a screen rendered on its own cannot mount at all. Zeroes
 * are the honest answer here — layout against a real notch is a device question, not one a
 * renderer can answer.
 */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => children,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: inset },
  };
});

/* ------------------------------------------------------------------- router */

/**
 * Screens are rendered on their own, without a navigator above them.
 *
 * `useFocusEffect` needs a real navigation context and throws without one, which is what
 * stops a screen mounting at all in a test. Here it behaves as the thing it actually is on a
 * screen that has just opened: an effect that runs once. Navigation itself is recorded rather
 * than performed, so a test can assert where a tap was meant to lead.
 */
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
  setParams: jest.fn(),
};

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useSegments: () => [],
    usePathname: () => '/',
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []),
    Link: ({ children }: { children?: React.ReactNode }) => React.createElement(Text, null, children),
    Redirect: () => null,
    Stack: Object.assign(() => null, { Screen: () => null }),
    Tabs: Object.assign(() => null, { Screen: () => null }),
  };
});

export const testRouter = mockRouter;

/** Sets the route params the screen under test will read. */
export function setRouteParams(params: Record<string, string>) {
  mockParams = params;
}

/* ------------------------------------------------------------------ sockets */

/**
 * A controllable fake socket. Tests deliver server events with `emitServer`, which is the
 * only way to exercise the listeners behind dispatch, bid acceptance and trip status.
 */
const mockHandlers = new Map<string, Set<(payload: any) => void>>();

const mockSocket = {
  on: jest.fn((event: string, fn: (payload: any) => void) => {
    if (!mockHandlers.has(event)) mockHandlers.set(event, new Set());
    mockHandlers.get(event)!.add(fn);
  }),
  off: jest.fn((event: string, fn: (payload: any) => void) => {
    mockHandlers.get(event)?.delete(fn);
  }),
  emit: jest.fn(),
  close: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('@/lib/socket', () => ({
  getSocket: jest.fn(async () => mockSocket),
  subscribeToTrip: jest.fn(() => () => {}),
  disconnectSocket: jest.fn(),
}));

export const testSocket = {
  ...mockSocket,
  /** Deliver an event as though the server had sent it. */
  emitServer(event: string, payload?: unknown) {
    for (const fn of mockHandlers.get(event) ?? []) fn(payload);
  },
  get emitted() {
    return mockSocket.emit.mock.calls;
  },
};

/* ------------------------------------------------------------------- resets */

beforeEach(() => {
  mockStore.clear();
  mockHandlers.clear();
  mockParams = {};
  jest.clearAllMocks();
});
