import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, ApiError, clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import { unregisterPush } from '@/lib/push';
import { normalizePhone } from '@/lib/phone';

// Confirmed camelCase values, decompiled_user.js ~403688-403694.
export type VehicleType = 'miniTruck' | 'pickup' | 'tataAce' | 'tempo' | 'largeTruck' | 'container';

export type VerificationStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUSPENDED';

export type TruckGoDriver = {
  id: string;
  role: 'DRIVER';
  fullName: string;
  phone: string;
  email: string | null;
  driverProfile: {
    vehicleType: VehicleType;
    vehicleNumber: string;
    // Shown read-only on Personal Information. `/drivers/me` has always returned it —
    // the type just never admitted it existed.
    drivingLicenseNumber: string | null;
    isOnline: boolean;
    ratingAvg: number;
    ratingCount: number;
    // Drives the dispatch gate. The server enforces it; the app explains it.
    verificationStatus: VerificationStatus;
    rejectionReason: string | null;
  } | null;
};

// Confirmed multipart fields, decompiled_driver.js:422320-422410, plus `verificationToken` —
// proof from POST /auth/verify-otp that this phone number was verified. The server rejects
// registration without it.
//
// Document numbers are validated for format here and against government records in Phase C;
// a driver stays blocked from going online or bidding until approved.
export type RegisterInput = {
  fullName: string;
  email?: string;
  phone: string;
  password: string;
  confirmPassword: string;
  verificationToken: string;
  vehicleType: VehicleType;
  vehicleNumber: string;
  drivingLicenseNumber: string;
  panCardNumber?: string;
  acceptTermsAndConditions: true;
  acceptPrivacyPolicy: true;
};

type AuthState = {
  user: TruckGoDriver | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TruckGoDriver | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    const token = await getAccessToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const data = await apiFetch<{ user: TruckGoDriver }>('/drivers/me');
      setUser(data.user);
    } catch (e) {
      // Only an actually-rejected session ends the session. A network blip or a
      // server error must not sign a driver out in the middle of a trip.
      if (e instanceof ApiError && e.isAuth) {
        await clearTokens();
        setUser(null);
      }
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  async function login(phone: string, password: string) {
    // The login field's placeholder shows "+91 98765 43210" — the backend's phoneSchema
    // rejects the embedded spaces outright. Normalizing here, not in the screen, means
    // every current and future caller of login() gets this for free.
    const data = await apiFetch<{ user: TruckGoDriver; accessToken: string; refreshToken: string }>(
      '/auth/driver',
      { method: 'POST', body: { phone: normalizePhone(phone), password }, auth: false },
    );
    await setTokens(data.accessToken, data.refreshToken);
    await refreshUser();
  }

  async function register(input: RegisterInput) {
    await apiFetch('/auth/register/driver', { method: 'POST', body: input, auth: false });
    await login(input.phone, input.password);
  }

  /**
   * Ends the session on the server as well as on the device.
   *
   * Clearing tokens locally only makes the app forget them — the refresh token stayed valid
   * for its full 30 days, so anyone who had captured it could keep minting access tokens for
   * an account its owner believes they signed out of. The socket also survived, still joined
   * to the previous user's rooms and still receiving their events.
   */
  async function logout() {
    // Release the push token first, while the access token is still valid — otherwise the
    // next driver to sign in on this phone inherits the last one's load alerts.
    await unregisterPush();
    // Best effort, and deliberately not allowed to block the sign-out: if the network is
    // down, the driver still gets signed out on this device.
    await apiFetch('/auth/logout', {
      method: 'POST',
      body: { refreshToken: await getRefreshToken() },
    }).catch(() => {});
    disconnectSocket();
    await clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
