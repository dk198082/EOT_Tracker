import { Router, type Request, type Response } from "express";
import * as oidc from "openid-client";
import { upsertLocalUser } from "../lib/localUser";
import { checkAdminConsoleAccess, AdminConsoleUnavailableError } from "../lib/admin-console-access";
import { verifyAndConsumeEmbeddedSsoToken } from "../lib/embedded-sso";
import {
  createSession,
  clearSession,
  deleteSession,
  getEntraTenantId,
  getOidcConfig,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type AuthUser,
  type SessionData,
} from "../lib/auth";

const router = Router();
const OIDC_COOKIE_TTL = 10 * 60 * 1000;

function getOrigin(req: Request) {
  const proto =
    req.headers["x-forwarded-proto"] ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "localhost";

  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function clearOidcCookies(res: Response) {
  for (const name of ["code_verifier", "nonce", "state", "return_to"]) {
    res.clearCookie(name, { path: "/" });
  }
}

function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function claimsToAuthUser(claims: Record<string, unknown>): AuthUser {
  const displayName = typeof claims.name === "string" ? claims.name.trim() : "";
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  return {
    id: String(claims.oid ?? claims.sub),
    email:
      typeof claims.email === "string"
        ? claims.email
        : typeof claims.preferred_username === "string"
          ? claims.preferred_username
          : null,
    firstName:
      typeof claims.given_name === "string"
        ? claims.given_name
        : nameParts[0] ?? null,
    lastName:
      typeof claims.family_name === "string"
        ? claims.family_name
        : nameParts.length > 1
          ? nameParts.slice(1).join(" ")
          : null,
    profileImageUrl: null,
  };
}

router.get("/auth/user", (req, res) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

router.get("/login", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/auth/callback`;
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const redirectTo = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      state,
      nonce,
    });

    setOidcCookie(res, "code_verifier", codeVerifier);
    setOidcCookie(res, "nonce", nonce);
    setOidcCookie(res, "state", state);
    setOidcCookie(res, "return_to", safeReturnTo(req.query.returnTo));
    res.redirect(redirectTo.href);
  } catch (error) {
    next(error);
  }
});

router.get("/auth/callback", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/auth/callback`;
    const codeVerifier = req.cookies?.code_verifier;
    const nonce = req.cookies?.nonce;
    const expectedState = req.cookies?.state;
    if (!codeVerifier || !expectedState) {
      res.redirect("/api/login");
      return;
    }

    const currentUrl = new URL(
      `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
    );
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) {
      res.redirect("/api/login");
      return;
    }

    const user = claimsToAuthUser(claims as unknown as Record<string, unknown>);
    if (!user.id || user.id === "undefined") {
      throw new Error("Microsoft Entra ID token did not include an object identifier");
    }

    let access;
    try {
      access = await checkAdminConsoleAccess(user.id);
    } catch (error) {
      if (error instanceof AdminConsoleUnavailableError) {
        clearOidcCookies(res);
        req.log.error(
          { adminConsoleCheck: error.kind },
          "Admin Console access check failed; sign-in blocked",
        );
        res.status(503).send("Application access could not be verified. Please try again later.");
        return;
      }
      throw error;
    }

    if (!access.allowed) {
      clearOidcCookies(res);
      res.status(403).send("You do not have access to this application. Contact your administrator.");
      return;
    }

    await upsertLocalUser(user);
    const sessionData: SessionData = {
      user,
    };
    const sid = await createSession(sessionData);
    
    const returnTo = safeReturnTo(req.cookies?.return_to);
    const frontendUrl = process.env.FRONTEND_URL?.trim();

    clearOidcCookies(res);
    setSessionCookie(res, sid);

    if (frontendUrl) {
      const redirectUrl = new URL(returnTo, frontendUrl);
      res.redirect(redirectUrl.href);
    } else {
      res.redirect(returnTo);
    }
  } catch (error) {
    next(error);
  }

});

router.get("/auth/embedded-sso", async (req, res, next) => {
  try {
    const token =
      typeof req.query.token === "string"
        ? req.query.token
        : "";

    const returnTo = safeReturnTo(req.query.returnTo);

    if (!token) {
      res.status(400).send("SSO token is required.");
      return;
    }

    const payload = await verifyAndConsumeEmbeddedSsoToken(
      token,
      "eto-tracker",
    );

    if (!payload) {
      res.status(401).send("Invalid, expired or already-used SSO token.");
      return;
    }

    let access;

    try {
      access = await checkAdminConsoleAccess(payload.sub);
    } catch (error) {
      if (error instanceof AdminConsoleUnavailableError) {
        req.log.error(
          { adminConsoleCheck: error.kind },
          "Workspace SSO authorization check failed",
        );

        res.status(503).send(
          "Application access could not be verified. Please try again later.",
        );
        return;
      }

      throw error;
    }

    if (!access.allowed) {
      res.status(403).send(
        "You do not have access to this application. Contact your administrator.",
      );
      return;
    }

    const user = await upsertLocalUser({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    });

    const sessionData: SessionData = {
      user: {
        id: user.authId!,
        email: user.email,
        firstName: user.name,
        lastName: null,
        profileImageUrl: null,
      },
    };

    const sid = await createSession(sessionData);

    clearOidcCookies(res);
    setSessionCookie(res, sid);

    const frontendUrl =
      process.env.FRONTEND_URL?.trim();

    if (!frontendUrl) {
      throw new Error(
        "FRONTEND_URL is not configured.",
      );
    }

    const destination = new URL(
      returnTo,
      `${frontendUrl.replace(/\/+$/, "")}/`,
    );

    destination.searchParams.set("embedded", "1");

    res.redirect(destination.href);

  } catch (error) {
    next(error);
  }
});

router.get("/logout", async (req, res, next) => {
  try {
    const returnTo = safeReturnTo(req.query.returnTo);
    const postLogoutRedirectUri = new URL(returnTo, `${getOrigin(req)}/`).href;
    await clearSession(res, getSessionId(req));
    const endSessionUrl = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(getEntraTenantId())}/oauth2/v2.0/logout`,
    );
    endSessionUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
    res.redirect(endSessionUrl.href);
  } catch (error) {
    next(error);
  }
});

router.post("/mobile-auth/logout", async (req, res) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.json({ success: true });
});

export default router;