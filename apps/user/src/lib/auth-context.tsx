import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, ApiError, clearTokens, getAccessToken, setTokens } from '@/lib/api';

export type TruckGoUser = {
  id: string;
  role: 'USER' | 'DRIVER';
  fullName: string;
  companyName: string | null;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
};

// Confirmed body shape, decompiled_user.js:483307, plus `verificationToken` — proof from
// POST /auth/verify-otp that this phone number was verified. The server rejects
// registration without it, so it is required here rather than optional.
export type RegisterInput = {
  fullName: string;
  companyName?: string;
  phone: string;
  email?: string;
  password: string;
  confirmPassword: string;
  verificationToken: string;
  acceptTermsAndConditions: true;
  acceptPrivacyPolicy: true;
};

type AuthState = {
  user: TruckGoUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TruckGoUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    const token = await getAccessToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const data = await apiFetch<{ user: TruckGoUser }>('/users/me');
      setUser(data.user);
    } catch (e) {
      // Only an actually-rejected session ends the session. A network blip or a
      // server error must not sign someone out in the middle of a trip.
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
    const data = await apiFetch<{ user: TruckGoUser; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    });
    await setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }

  async function register(input: RegisterInput) {
    await apiFetch('/auth/register/user', { method: 'POST', body: input, auth: false });
    await login(input.phone, input.password);
  }

  async function logout() {
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
