/** Verify Azure writes/reads in a rolled-back transaction without touching existing ETOs. */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { pool, ETO_DATABASE } from "@workspace/db";
import { SubmitTransitionBody, UpsertArtFinalOutputBody } from "@workspace/api-zod";
import { normalizeRequiredQuoteDescription } from "../lib/quote-description";

async function main() {
  assert.ok(SubmitTransitionBody.safeParse({ decision: "approve-engineering", entity: "TOUS" }).success);
  assert.ok(SubmitTransitionBody.safeParse({ decision: "approve-engineering", entity: "TOUK" }).success);
  assert.equal(SubmitTransitionBody.safeParse({ decision: "approve-engineering", entity: "OTHER" }).success, false);
  assert.ok(SubmitTransitionBody.safeParse({
    decision: "art-final-quote", artMarketPrice: "500", artMarketLeadtime: "5",
    artQuoteDescription: "Verification part description",
  }).success);
  assert.equal(SubmitTransitionBody.safeParse({
    decision: "art-final-quote", artQuoteDescription: 123,
  }).success, false);
  assert.equal(normalizeRequiredQuoteDescription(undefined), null);
  assert.equal(normalizeRequiredQuoteDescription(" \t "), null);
  assert.equal(normalizeRequiredQuoteDescription("  Verification part  "), "Verification part");
  assert.equal(UpsertArtFinalOutputBody.safeParse({ quoteDescription: null }).success, false);

  const client = await pool.connect();
  const id = randomInt(-2147483647, -1000000);
  try {
    const target = await client.query("SELECT current_database() = $1 AS correct_database", [ETO_DATABASE]);
    assert.equal(target.rows[0]?.correct_database, true);
    await client.query("BEGIN");
    const users = await client.query("SELECT id FROM crm.eto_users ORDER BY id LIMIT 1");
    if (!users.rows.length) throw new Error("A user row is required for the rollback-only verification");
    await client.query(
      `INSERT INTO crm.eto_requests
        (id, customer_name, quote_number, materials, specimen_dimensions, submitted_by_id, entity)
        VALUES ($1, 'Rollback-only ART verification', 'ART-FIELD-CHECK', 'Verification', 'Verification', $2, 'TOUS')`,
      [id, users.rows[0].id],
    );
    await client.query("UPDATE crm.eto_requests SET entity = 'TOUK' WHERE id = $1", [id]);
    assert.equal((await client.query("SELECT entity FROM crm.eto_requests WHERE id = $1", [id])).rows[0].entity, "TOUK");
    await client.query(
      `INSERT INTO crm.eto_art_final_outputs (id, eto_request_id, quote_description)
        VALUES ($1, $1, 'Verification part description')`,
      [id],
    );
    await client.query(
      "UPDATE crm.eto_art_final_outputs SET quote_description = 'Updated part description' WHERE eto_request_id = $1", [id],
    );
    // A caller that omits Description may update another field without erasing it.
    await client.query("UPDATE crm.eto_art_final_outputs SET market_leadtime = '5' WHERE eto_request_id = $1", [id]);
    assert.equal((await client.query(
      "SELECT quote_description FROM crm.eto_art_final_outputs WHERE eto_request_id = $1", [id],
    )).rows[0].quote_description, "Updated part description");
    // The required-field validator blocks future application writes to empty descriptions.
    await client.query("UPDATE crm.eto_art_final_outputs SET quote_description = NULL WHERE eto_request_id = $1", [id]);
    assert.equal((await client.query(
      "SELECT quote_description FROM crm.eto_art_final_outputs WHERE eto_request_id = $1", [id],
    )).rows[0].quote_description, null);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT id FROM crm.eto_requests WHERE id = $1", [id])).rowCount, 0);
    console.log("PASS: entity choices, quote text contract, Azure create/read/update/clear, rollback cleanup; no business records committed");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "ART quote verification failed");
  process.exitCode = 1;
}).finally(() => pool.end());
