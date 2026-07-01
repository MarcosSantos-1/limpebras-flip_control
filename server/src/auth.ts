import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { config } from "./config.js";
import { decryptPassword, passwordsMatch } from "./auth-crypto.js";
import { APP_PAGE_KEYS, buildDefaultPermissions, isAppPageKey, type AppPageKey, type UserRole } from "./auth-shared.js";

const SESSION_COOKIE_NAME = "flip_auth";
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const NON_HOST_VISIBLE_PAGES = APP_PAGE_KEYS.filter((page) => page !== "admin_users");
const CCO_ALLOWED_PAGES: AppPageKey[] = ["ipt", "ipt_despachos", "plano_trabalho", "upload", "cco"];

/** Último UPDATE de last_seen_at por sessão (por processo) — evita 1 write por request. */
const lastSeenUpdateAt = new Map<string, number>();

type SessionRow = {
  session_id: string;
  user_id: number;
  username: string;
  display_name: string | null;
  role: UserRole;
  status: string;
  blocked: boolean;
  expires_at: Date;
  page_permissions: AppPageKey[] | null;
};

export type AuthUser = {
  id: number;
  username: string;
  displayName: string | null;
  role: UserRole;
  status: string;
  blocked: boolean;
  allowedPages: Record<AppPageKey, boolean>;
  isIptRestricted: boolean;
  isCco: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
    authSessionId: string | null;
  }
}

function signSessionId(sessionId: string): string {
  const signature = crypto.createHmac("sha256", config.authSecret).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}

function verifySignedSessionId(rawCookie: string | undefined): string | null {
  if (!rawCookie) return null;
  const lastDot = rawCookie.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const sessionId = rawCookie.slice(0, lastDot);
  const receivedSig = rawCookie.slice(lastDot + 1);
  const expectedSig = crypto.createHmac("sha256", config.authSecret).update(sessionId).digest("base64url");
  const a = Buffer.from(receivedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? sessionId : null;
}

function parseCookies(request: FastifyRequest): Record<string, string> {
  const raw = request.headers.cookie;
  if (!raw) return {};
  return Object.fromEntries(
    raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const idx = item.indexOf("=");
        const key = idx >= 0 ? item.slice(0, idx) : item;
        const value = idx >= 0 ? item.slice(idx + 1) : "";
        return [decodeURIComponent(key), decodeURIComponent(value)];
      })
  );
}

function parsePermissions(pagePermissions: AppPageKey[] | null, role: UserRole): Record<AppPageKey, boolean> {
  const defaults = buildDefaultPermissions(role);
  if (!pagePermissions?.length) return defaults;
  const allowed = new Set(pagePermissions.filter((page): page is AppPageKey => isAppPageKey(page)));
  if (role !== "host" && allowed.has("cco")) {
    CCO_ALLOWED_PAGES.forEach((page) => allowed.add(page));
  }
  if (role !== "host") {
    allowed.delete("admin_users");
  }
  return Object.fromEntries(APP_PAGE_KEYS.map((page) => [page, role === "host" ? true : allowed.has(page)])) as Record<
    AppPageKey,
    boolean
  >;
}

function mapSessionRowToAuthUser(row: SessionRow): AuthUser {
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    blocked: row.blocked,
    allowedPages: parsePermissions(row.page_permissions, row.role),
    isIptRestricted: row.role !== "host" && row.page_permissions?.includes("ipt_restrito") === true,
    isCco: row.role !== "host" && row.page_permissions?.includes("cco") === true,
  };
}

export async function createSession(userId: number, rememberMe: boolean) {
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + (rememberMe ? SESSION_TTL_MS : 24 * 60 * 60 * 1000));

  await pool.query(
    `INSERT INTO auth_sessions (session_id, user_id, session_token_hash, remember_me, expires_at, last_seen_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
    [sessionId, userId, tokenHash, rememberMe, expiresAt]
  );
  await pool.query("UPDATE users SET last_access_at = NOW(), updated_at = NOW() WHERE id = $1", [userId]).catch(() => {});

  return { sessionId, signedSessionId: signSessionId(sessionId), token, expiresAt, rememberMe };
}

export async function deleteSession(sessionId: string | null) {
  if (!sessionId) return;
  lastSeenUpdateAt.delete(sessionId);
  await pool.query("DELETE FROM auth_sessions WHERE session_id = $1", [sessionId]);
}

export async function getRequestAuth(request: FastifyRequest): Promise<{ user: AuthUser | null; sessionId: string | null }> {
  const cookies = parseCookies(request);
  const signedSessionId = cookies[SESSION_COOKIE_NAME];
  const rawToken = request.headers["x-session-token"];
  const sessionToken = typeof rawToken === "string" ? rawToken : null;
  const sessionId = verifySignedSessionId(signedSessionId);
  if (!sessionId || !sessionToken) return { user: null, sessionId: null };

  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  const result = await pool.query<SessionRow>(
    `SELECT
        s.session_id,
        u.id AS user_id,
        u.username,
        u.display_name,
        u.role,
        u.status,
        u.blocked,
        s.expires_at,
        ARRAY_REMOVE(ARRAY_AGG(p.page_key), NULL) AS page_permissions
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_page_permissions p ON p.user_id = u.id AND p.allowed = true
      WHERE s.session_id = $1
        AND s.session_token_hash = $2
        AND s.expires_at > NOW()
      GROUP BY s.session_id, u.id, u.username, u.display_name, u.role, u.status, u.blocked, s.expires_at`,
    [sessionId, tokenHash]
  );

  const row = result.rows[0];
  if (!row || row.blocked || row.status !== "active") {
    return { user: null, sessionId };
  }

  await maybeTouchSessionLastSeen(sessionId);
  return { user: mapSessionRowToAuthUser(row), sessionId };
}

async function maybeTouchSessionLastSeen(sessionId: string): Promise<void> {
  const now = Date.now();
  const throttle = config.authLastSeenThrottleMs;
  const prev = lastSeenUpdateAt.get(sessionId);
  if (prev !== undefined && now - prev < throttle) return;

  lastSeenUpdateAt.set(sessionId, now);
  await pool
    .query(
      `WITH touched AS (
         UPDATE auth_sessions
         SET last_seen_at = NOW(), updated_at = NOW()
         WHERE session_id = $1
         RETURNING user_id
       )
       UPDATE users
       SET last_access_at = NOW(), updated_at = NOW()
       WHERE id IN (SELECT user_id FROM touched)`,
      [sessionId]
    )
    .catch(() => {});
}

/** Em produção (HTTPS), front e API em domínios diferentes precisam SameSite=None + Secure para o cookie ir no axios/fetch. */
function sessionCookieFlags(): string[] {
  if (process.env.NODE_ENV === "production") {
    return ["SameSite=None", "Secure"];
  }
  return ["SameSite=Lax"];
}

export function applySessionCookies(
  reply: FastifyReply,
  session: { signedSessionId: string; expiresAt: Date; rememberMe: boolean }
) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.signedSessionId)}`,
    "Path=/",
    "HttpOnly",
    ...sessionCookieFlags(),
  ];
  if (session.rememberMe) {
    cookieParts.push(`Expires=${session.expiresAt.toUTCString()}`);
    cookieParts.push(`Max-Age=${Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)}`);
  }
  reply.header("Set-Cookie", cookieParts.join("; "));
}

export function clearSessionCookie(reply: FastifyReply) {
  const flags = sessionCookieFlags().join("; ");
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${flags}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`
  );
}

export async function attachAuthToRequest(request: FastifyRequest) {
  const auth = await getRequestAuth(request);
  request.authUser = auth.user;
  request.authSessionId = auth.sessionId;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  if (!request.authUser) {
    await reply.code(401).send({ detail: "Autenticação obrigatória." });
    return null;
  }
  return request.authUser;
}

export async function requireHost(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await requireAuth(request, reply);
  if (!user) return null;
  if (user.role !== "host") {
    await reply.code(403).send({ detail: "Acesso restrito ao host." });
    return null;
  }
  return user;
}

export async function requirePageAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  pageKey: AppPageKey
): Promise<AuthUser | null> {
  const user = await requireAuth(request, reply);
  if (!user) return null;
  const canAccess = user.role === "host" || user.allowedPages[pageKey] === true;
  if (!canAccess) {
    await reply.code(403).send({ detail: "Sem permissão para acessar esta página." });
    return null;
  }
  return user;
}

export function getVisiblePagesForUser(role: UserRole): AppPageKey[] {
  return role === "host" ? [...APP_PAGE_KEYS] : [...NON_HOST_VISIBLE_PAGES];
}
