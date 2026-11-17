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

// AZURE: Azure App Service/Container Apps terminates TLS at a reverse proxy
// in front of the container and forwards plain HTTP, setting X-Forwarded-*
// headers. Without this, req.secure/req.protocol would read "http".
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
// AZURE: none of the mounted routers above 404 an unmatched path themselves,
// so without this, an unknown /api/* path would fall through into the SPA
// static fallback below (once STATIC_DIR serving is added for Azure) and
// wrongly return 200 with index.html.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// AZURE: on Replit, the frontend (artifacts/eto-tracker) and this API are two
// separate deployed services. On Azure this ships as one container, so this
// server also serves the built frontend as static files, with an SPA
// fallback for client-side routes. Unset in local dev; set by the Dockerfile
// in production.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const indexHtml = path.join(staticDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`STATIC_DIR is set to "${staticDir}" but "${indexHtml}" does not exist. Did the frontend build run?`);
  }
  app.use(express.static(staticDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

export default app;
