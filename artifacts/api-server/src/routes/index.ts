import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import etoRequestsRouter from "./eto-requests";
import transitionsRouter from "./transitions";
import emailHistoryRouter from "./email-history";
import commentsRouter from "./comments";
import attachmentsRouter, { requirePreviewAccess } from "./attachments";
import outputsRouter from "./outputs";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import adminRouter from "./admin";
import authRouter from "./auth";
import priceCalculatorRouter from "./price-calculator";
import { requireAuth, requireAuthAllowNone } from "../middlewares/requireAuth";
import { archiveStore } from "../lib/shared-merge/database";
import { sharedArchiveMiddleware, sharedPolicyPath } from "../lib/shared-merge/runtime";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Signed same-origin previews deliberately work when a PDF viewer omits the
// session cookie. Validate that access before archive inspection.
router.use("/eto-requests/:id/attachments/:attachmentId/preview", requirePreviewAccess);
// Authentication precedes trusted schema/identity inspection. This covers all
// existing request mutations, including file URL issuance and future subroutes.
router.use((req, res, next) => {
  const path = sharedPolicyPath(req.path);
  if (req.method === "GET" && /^\/eto-requests\/[^/]+\/attachments\/[^/]+\/preview$/.test(path)) {
    next(); return;
  }
  if (/^\/(?:eto-requests|users|admin|dashboard)(?:\/|$)/.test(path) || path === "/storage/uploads/request-url") {
    const isOwnProfileRead = req.method === "GET" && path === "/users/me";
    (isOwnProfileRead ? requireAuthAllowNone : requireAuth)(req, res, next);
  } else next();
});
router.use(sharedArchiveMiddleware(archiveStore));
router.use("/users", usersRouter);
router.use("/eto-requests", etoRequestsRouter);
router.use("/eto-requests/:id/transitions", transitionsRouter);
router.use("/eto-requests/:id/email-history", emailHistoryRouter);
router.use("/eto-requests/:id/comments", commentsRouter);
router.use("/eto-requests/:id/attachments", attachmentsRouter);
router.use("/eto-requests/:id", outputsRouter);
router.use("/dashboard", dashboardRouter);
router.use(storageRouter);
router.use("/admin", adminRouter);
router.use(priceCalculatorRouter);

export default router;
