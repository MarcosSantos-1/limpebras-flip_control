const SESSION_TOKEN_KEY = "flip-session-token";

export function getStoredSessionToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

export function setStoredSessionToken(value: string | null) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, value);
  } else {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}
