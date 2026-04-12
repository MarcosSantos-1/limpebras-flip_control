import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { createSession, applySessionCookies, clearSessionCookie, deleteSession, requireAuth } from "../auth.js";
import { decryptPassword, passwordsMatch } from "../auth-crypto.js";
import { APP_PAGE_KEYS, DEFAULT_USER_ALLOWED_PAGES, buildDefaultPermissions, isAppPageKey, type AppPageKey, type UserRole } from "../auth-shared.js";
import { encryptPassword } from "../auth-crypto.js";

type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  password_encrypted: string;
  role: UserRole;
  status: string;
  blocked: boolean;
  page_permissions: AppPageKey[] | null;
};

function safeDecryptVisiblePassword(encrypted: string): string {
  try {
    return decryptPassword(encrypted);
  } catch {
    /** Senha cifrada com outro AUTH_SECRET (ex.: após troca no deploy). Regrave a senha no painel. */
    return "";
  }
}

function sanitizeUser(row: UserRow) {
  const defaults = buildDefaultPermissions(row.role);
  const allowed = new Set((row.page_permissions ?? []).filter((page): page is AppPageKey => isAppPageKey(page)));
  const pagePermissions = Object.fromEntries(
    APP_PAGE_KEYS.map((pageKey) => [pageKey, row.role === "host" ? true : allowed.has(pageKey)])
  ) as Record<AppPageKey, boolean>;

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    blocked: row.blocked,
    page_permissions: pagePermissions,
    is_ipt_restricted: row.role !== "host" && allowed.has("ipt_restrito"),
    visible_password: safeDecryptVisiblePassword(row.password_encrypted),
  };
}

async function getUserByUsername(username: string) {
  const result = await pool.query<UserRow>(
    `SELECT
        u.id,
        u.username,
        u.display_name,
        u.password_encrypted,
        u.role,
        u.status,
        u.blocked,
        ARRAY_REMOVE(ARRAY_AGG(p.page_key), NULL) AS page_permissions
      FROM users u
      LEFT JOIN user_page_permissions p ON p.user_id = u.id AND p.allowed = TRUE
      WHERE LOWER(u.username) = LOWER($1)
      GROUP BY u.id`,
    [username]
  );
  return result.rows[0] ?? null;
}

async function getUserById(id: number) {
  const result = await pool.query<UserRow>(
    `SELECT
        u.id,
        u.username,
        u.display_name,
        u.password_encrypted,
        u.role,
        u.status,
        u.blocked,
        ARRAY_REMOVE(ARRAY_AGG(p.page_key), NULL) AS page_permissions
      FROM users u
      LEFT JOIN user_page_permissions p ON p.user_id = u.id AND p.allowed = TRUE
      WHERE u.id = $1
      GROUP BY u.id`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function replacePermissions(userId: number, role: UserRole, pagePermissions?: Record<string, boolean>) {
  await pool.query("DELETE FROM user_page_permissions WHERE user_id = $1", [userId]);
  const allowedPages =
    role === "host"
      ? APP_PAGE_KEYS
      : APP_PAGE_KEYS.filter((pageKey) =>
          pagePermissions && pageKey in pagePermissions
            ? pagePermissions[pageKey] === true
            : DEFAULT_USER_ALLOWED_PAGES.includes(pageKey)
        );

  for (const pageKey of allowedPages) {
    await pool.query(
      `INSERT INTO user_page_permissions (user_id, page_key, allowed, updated_at)
       VALUES ($1, $2, TRUE, NOW())`,
      [userId, pageKey]
    );
  }
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: { username?: string; password?: string; rememberMe?: boolean };
  }>("/auth/login", async (request, reply) => {
    const username = String(request.body?.username ?? "").trim();
    const password = String(request.body?.password ?? "");
    const rememberMe = request.body?.rememberMe === true;

    if (!username || !password) {
      return reply.code(400).send({ detail: "Usuário e senha são obrigatórios." });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return reply.code(401).send({ detail: "Usuário ou senha inválidos." });
    }

    let passwordOk = passwordsMatch(user.password_encrypted, password);

    // Recupera o admin padrão se o banco tiver uma senha antiga/incompatível
    // com o segredo atual do ambiente local.
    if (!passwordOk && user.username.toLowerCase() === "admin" && password === "1515") {
      try {
        decryptPassword(user.password_encrypted);
      } catch {
        const repairedPassword = encryptPassword("1515");
        await pool.query(
          `UPDATE users
           SET password_encrypted = $2, updated_at = NOW()
           WHERE id = $1`,
          [user.id, repairedPassword]
        );
        user.password_encrypted = repairedPassword;
        passwordOk = true;
      }
    }

    if (!passwordOk) {
      return reply.code(401).send({ detail: "Usuário ou senha inválidos." });
    }
    if (user.blocked || user.status !== "active") {
      return reply.code(403).send({ detail: "Usuário bloqueado ou inativo." });
    }

    const session = await createSession(user.id, rememberMe);
    applySessionCookies(reply, session);

    return reply.send({
      user: sanitizeUser(user),
      session_token: session.token,
      remember_me: rememberMe,
      expires_at: session.expiresAt.toISOString(),
    });
  });

  fastify.post("/auth/logout", async (request, reply) => {
    await deleteSession(request.authSessionId ?? null);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  fastify.get("/auth/me", async (request, reply) => {
    const authUser = await requireAuth(request, reply);
    if (!authUser) return;
    const dbUser = await getUserById(authUser.id);
    if (!dbUser) {
      await deleteSession(request.authSessionId ?? null);
      clearSessionCookie(reply);
      return reply.code(401).send({ detail: "Sessão inválida." });
    }
    return reply.send({ user: sanitizeUser(dbUser) });
  });

  fastify.get("/auth/users", async (request, reply) => {
    const authUser = await requireAuth(request, reply);
    if (!authUser) return;
    if (authUser.role !== "host") {
      return reply.code(403).send({ detail: "Acesso restrito ao host." });
    }

    const result = await pool.query<UserRow>(
      `SELECT
          u.id,
          u.username,
          u.display_name,
          u.password_encrypted,
          u.role,
          u.status,
          u.blocked,
          ARRAY_REMOVE(ARRAY_AGG(p.page_key), NULL) AS page_permissions
        FROM users u
        LEFT JOIN user_page_permissions p ON p.user_id = u.id AND p.allowed = TRUE
        GROUP BY u.id
        ORDER BY LOWER(u.username) ASC`
    );

    return reply.send({
      items: result.rows.map(sanitizeUser),
      total: result.rows.length,
      page_keys: APP_PAGE_KEYS,
    });
  });

  fastify.post<{
    Body: {
      username?: string;
      display_name?: string;
      password?: string;
      role?: UserRole;
      status?: string;
      blocked?: boolean;
      page_permissions?: Record<string, boolean>;
    };
  }>("/auth/users", async (request, reply) => {
    const authUser = await requireAuth(request, reply);
    if (!authUser) return;
    if (authUser.role !== "host") {
      return reply.code(403).send({ detail: "Acesso restrito ao host." });
    }

    const username = String(request.body?.username ?? "").trim();
    const password = String(request.body?.password ?? "");
    const displayName = String(request.body?.display_name ?? "").trim() || null;
    const role = request.body?.role === "host" ? "host" : "user";
    const status = request.body?.status === "inactive" ? "inactive" : "active";
    const blocked = request.body?.blocked === true;

    if (!username || !password) {
      return reply.code(400).send({ detail: "Usuário e senha são obrigatórios." });
    }

    const existing = await getUserByUsername(username);
    if (existing) {
      return reply.code(409).send({ detail: "Já existe um usuário com esse login." });
    }

    const insert = await pool.query<{ id: number }>(
      `INSERT INTO users (username, display_name, password_encrypted, role, status, blocked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [username, displayName, encryptPassword(password), role, status, blocked]
    );
    const userId = insert.rows[0]?.id;
    if (userId) {
      await replacePermissions(userId, role, request.body?.page_permissions);
    }

    const created = userId ? await getUserById(userId) : null;
    return reply.code(201).send({ user: created ? sanitizeUser(created) : null });
  });

  fastify.patch<{
    Params: { id: string };
    Body: {
      display_name?: string;
      password?: string;
      role?: UserRole;
      status?: string;
      blocked?: boolean;
      page_permissions?: Record<string, boolean>;
    };
  }>("/auth/users/:id", async (request, reply) => {
    const authUser = await requireAuth(request, reply);
    if (!authUser) return;
    if (authUser.role !== "host") {
      return reply.code(403).send({ detail: "Acesso restrito ao host." });
    }

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ detail: "ID de usuário inválido." });
    }

    const current = await getUserById(id);
    if (!current) {
      return reply.code(404).send({ detail: "Usuário não encontrado." });
    }

    const role = request.body?.role === "host" ? "host" : request.body?.role === "user" ? "user" : current.role;
    const status = request.body?.status === "inactive" ? "inactive" : request.body?.status === "active" ? "active" : current.status;
    const blocked = request.body?.blocked ?? current.blocked;
    const displayName =
      request.body && "display_name" in request.body ? String(request.body.display_name ?? "").trim() || null : current.display_name;
    const password =
      request.body?.password && String(request.body.password).trim()
        ? encryptPassword(String(request.body.password))
        : current.password_encrypted;

    await pool.query(
      `UPDATE users
       SET display_name = $2,
           password_encrypted = $3,
           role = $4,
           status = $5,
           blocked = $6,
           updated_at = NOW()
       WHERE id = $1`,
      [id, displayName, password, role, status, blocked]
    );
    await replacePermissions(id, role, request.body?.page_permissions);

    if (blocked || status !== "active") {
      await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [id]);
    }

    const updated = await getUserById(id);
    return reply.send({ user: updated ? sanitizeUser(updated) : null });
  });
};
