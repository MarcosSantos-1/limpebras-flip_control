"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiService, type AuthPageKey, type AuthUser, type LoginPayload } from "@/lib/api";
import { setStoredSessionToken } from "@/lib/session-storage";
import { clearWebSessionCookie, setWebSessionCookie } from "@/lib/web-session-cookie";

const REMEMBER_FLAG_KEY = "flip-remember-me";
const REMEMBER_USERNAME_KEY = "flip-remember-username";
const REMEMBER_PASSWORD_KEY = "flip-remember-password";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  rememberedUsername: string;
  rememberedPassword: string;
  rememberMeSaved: boolean;
  login: (payload: LoginPayload) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPageAccess: (pageKey: AuthPageKey) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

function removeStorage(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function persistRememberData(username: string, password: string, rememberMe: boolean) {
  if (rememberMe) {
    writeStorage(REMEMBER_FLAG_KEY, "1");
    writeStorage(REMEMBER_USERNAME_KEY, username);
    writeStorage(REMEMBER_PASSWORD_KEY, password);
    return;
  }
  removeStorage(REMEMBER_FLAG_KEY);
  removeStorage(REMEMBER_USERNAME_KEY);
  removeStorage(REMEMBER_PASSWORD_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [rememberedUsername, setRememberedUsername] = useState("");
  const [rememberedPassword, setRememberedPassword] = useState("");
  const [rememberMeSaved, setRememberMeSaved] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setRememberedUsername(readStorage(REMEMBER_USERNAME_KEY));
    setRememberedPassword(readStorage(REMEMBER_PASSWORD_KEY));
    setRememberMeSaved(readStorage(REMEMBER_FLAG_KEY) === "1");
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiService.getCurrentUser();
      setUser(data.user);
      if (typeof window !== "undefined") {
        setWebSessionCookie();
      }
    } catch {
      setUser(null);
      setStoredSessionToken(null);
      if (typeof window !== "undefined") {
        clearWebSessionCookie();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (loading) return;
    if (!user && pathname !== "/login") {
      router.replace("/login");
      return;
    }
    if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [loading, pathname, router, user]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      try {
        const data = await apiService.login(payload);
        setStoredSessionToken(data.session_token);
        persistRememberData(payload.username, payload.password, payload.rememberMe);
        setRememberedUsername(payload.rememberMe ? payload.username : "");
        setRememberedPassword(payload.rememberMe ? payload.password : "");
        setRememberMeSaved(payload.rememberMe);
        setUser(data.user);
        if (typeof window !== "undefined") {
          setWebSessionCookie();
          window.sessionStorage.setItem("flip_show_welcome", "1");
          window.sessionStorage.setItem("flip_upload_reminder_delay_ms", "700");
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: apiService.extractErrorMessage(error, "Não foi possível fazer login."),
        };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiService.logout();
    } catch {
      // ignore network failures on logout cleanup
    } finally {
      setStoredSessionToken(null);
      setUser(null);
      if (typeof window !== "undefined") {
        clearWebSessionCookie();
        window.sessionStorage.removeItem("flip_show_welcome");
        window.sessionStorage.removeItem("flip_upload_reminder_delay_ms");
      }
      router.replace("/login");
    }
  }, [router]);

  const hasPageAccess = useCallback(
    (pageKey: AuthPageKey) => {
      if (!user) return false;
      return user.role === "host" || user.page_permissions?.[pageKey] === true;
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      rememberedUsername,
      rememberedPassword,
      rememberMeSaved,
      login,
      logout,
      refreshUser,
      hasPageAccess,
    }),
    [hasPageAccess, loading, login, logout, rememberMeSaved, rememberedPassword, rememberedUsername, refreshUser, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
