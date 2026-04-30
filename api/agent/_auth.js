import { verifyToken } from "@clerk/backend";

/**
 * Extracts and verifies the Clerk JWT from the Authorization header.
 * Returns the authenticated userId if valid, or null if not.
 */
export async function authenticateRequest(req) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey,
      authorizedParties: [
        "https://365tasks.online",
        "http://localhost:5173",
        "http://localhost:3000",
      ],
    });
    return payload?.sub || null;
  } catch (err) {
    console.error("clerk_auth_failed", err?.message || err);
    return null;
  }
}

/**
 * Middleware-style helper: verifies auth and checks that the authenticated
 * user matches the requested userId. Returns the verified userId or sends
 * a 401/403 response and returns null.
 */
export async function requireAuth(req, res, requestedUserId) {
  const authedUserId = await authenticateRequest(req);
  if (!authedUserId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (requestedUserId && authedUserId !== requestedUserId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return authedUserId;
}
