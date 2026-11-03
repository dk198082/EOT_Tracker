import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkAzureCrmConnection } from "@workspace/db/azure-crm";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/azure-crm", async (_req, res) => {
  const health = await checkAzureCrmConnection();
  res.status(health.status === "ok" ? 200 : 503).json(health);
});

export default router;
