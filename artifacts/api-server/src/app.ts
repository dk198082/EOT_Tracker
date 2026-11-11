import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { getTrustedOrigins } from "./lib/trustedOrigins";

const app: Express = express();
// --- AZURE DEPLOYMENT ---------------------------------------------------
// Azure App Service / Container Apps sit the container behind a load
// balancer/reverse proxy; trusting it so req.protocol/req.secure and
// secure cookies reflect the real (HTTPS) client request, not the
// container's own plain-HTTP listener.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Restrict credentialed CORS to an explicit exact-match allowlist.
// Never use substring/prefix/wildcard matching with credentials:true — a malicious
// host that happens to contain a trusted substring would otherwise be allowed.
const trustedOriginsSet = getTrustedOrigins();

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Allow requests with no Origin header (same-origin / server-to-server)
      // and exact members of the allowlist only.
      if (!origin || trustedOriginsSet.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not in the allowed list`));
      }
    },
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

// --- AZURE DEPLOYMENT ---------------------------------------------------
// Optional single-service mode: if STATIC_DIR points at the built frontend
// (artifacts/eto-tracker/dist/public), this API server also serves it, so
// the whole app runs as ONE Azure App Service / Container Apps instance on
// ONE origin. That keeps the session cookie same-site/same-origin and
// avoids needing a second Azure resource. Unset in local dev (the Vite dev
// server serves the frontend on its own port instead) and set by
// ./Dockerfile / AZURE_DEPLOYMENT.md in production.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  if (!fs.existsSync(path.join(resolvedStaticDir, "index.html"))) {
    throw new Error(
      `STATIC_DIR is set to "${resolvedStaticDir}" but no index.html was found there. ` +
        "Build the frontend first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use(express.static(resolvedStaticDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

export default app;
