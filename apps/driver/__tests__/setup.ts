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
  jest.clearAllMocks();
});
