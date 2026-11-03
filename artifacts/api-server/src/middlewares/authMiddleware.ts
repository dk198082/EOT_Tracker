import type { NextFunction, Request, Response } from "express";
import {
  clearSession,
  getSession,
  getSessionId,
  type AuthUser,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      isAuthenticated(): this is Request & { user: User };
      user?: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      await clearSession(res, sid);
      next();
      return;
    }

    req.user = session.user;
    next();
  } catch (error) {
    next(error);
  }
}