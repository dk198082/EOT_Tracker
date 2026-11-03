import app from "./app";
import { logger } from "./lib/logger";
import { checkEmailConfig } from "./lib/email";
import cron from "node-cron";
import { runReminders } from "./scripts/remind";
import { runAttachmentIndexing } from "./scripts/indexAttachments";
import { checkAzureCrmConnection } from "@workspace/db/azure-crm";
import { verifyEtoDatabase } from "@workspace/db";
import { importRoleAssignmentsOnce, prepareEntraSuperUsers } from "./lib/roleImport";
import { reassignEtoSubmittersOnce } from "./lib/etoSubmitterImport";
import { archiveStore } from "./lib/shared-merge/database";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Warn immediately at startup if email env vars are missing.
checkEmailConfig();

// Provision pending access and repair existing Entra roles before accepting
// sign-ins, so a first login cannot race the role repair.
void verifyEtoDatabase().then(async () => {
  const sharedEpoch = await archiveStore.epoch();
  // Imported identity/role authority belongs to the approved merge. Legacy
  // startup repair jobs must not rewrite it after a compatible shared cutover.
  return { sharedEpoch, ...(sharedEpoch ? { applied: false, matchedUsers: 0 } : await prepareEntraSuperUsers()) };
}).then(({ applied, matchedUsers, sharedEpoch }) => {
  if (applied) {
    logger.info({ matchedUsers }, "Repaired Entra-linked SuperUser roles");
  }
  app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void checkAzureCrmConnection()
    .then((health) => {
      if (health.status === "ok") {
        logger.info("Azure CRM PostgreSQL connection is healthy");
      } else if (health.reason === "not_configured") {
        logger.warn("Azure CRM PostgreSQL connection is not configured");
      } else {
        logger.error("Azure CRM PostgreSQL connection check failed");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "Azure CRM PostgreSQL configuration is invalid");
    });

  if (!sharedEpoch) void importRoleAssignmentsOnce()
    .then(({ applied, matchedUsers }) => {
      if (applied) {
        logger.info(
          { matchedUsers },
          "Imported development user roles into matching signed-in users",
        );
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "One-time user role import failed");
    });

  if (!sharedEpoch && process.env.NODE_ENV === "production") {
    void reassignEtoSubmittersOnce()
      .then(({ applied, reassignedRequests }) => {
        if (applied) {
          logger.info(
            { reassignedRequests },
            "Reassigned legacy demo ETO requests to Justin Seidler",
          );
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, "One-time ETO submitter reassignment failed");
      });
  }

  // Schedule daily inactivity reminder sweep at 08:00 UTC.
  // Also run once on startup so a repl restart never skips a day.
  cron.schedule("0 8 * * *", () => {
    runReminders();
  });
  runReminders();

  // Keep attachment contents searchable without delaying upload requests.
  // Running on startup also provides a resumable backfill for existing rows.
  cron.schedule("*/2 * * * *", () => {
    runAttachmentIndexing();
  });
  runAttachmentIndexing();
  });
}).catch((err: unknown) => {
  logger.error({ err }, "Failed to prepare Entra SuperUser access");
  process.exit(1);
});
