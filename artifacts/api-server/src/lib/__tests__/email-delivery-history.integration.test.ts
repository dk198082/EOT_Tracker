import { expect, it } from "vitest";
import { pool } from "@workspace/db";

it("persists a grouped event and its outcome in Azure CRM without retaining test rows", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query("SELECT id FROM crm.eto_requests ORDER BY id LIMIT 1");
    if (!request.rows.length) throw new Error("A request is required for the rollback-only audit verification");
    const messages = [
      { name: "Sales update", subject: "Synthetic verification", recipients: ["sales@example.test"], status: "pending" },
      { name: "Assignment", subject: "Synthetic verification", recipients: ["reviewer@example.test"], status: "pending" },
    ];
    const inserted = await client.query(
      `INSERT INTO crm.eto_email_delivery_events (eto_request_id, event_name, recipients, messages)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [request.rows[0].id, "Rollback-only verification", ["sales@example.test", "reviewer@example.test"], JSON.stringify(messages)],
    );
    const id = inserted.rows[0].id;
    await client.query(
      "UPDATE crm.eto_email_delivery_events SET status = 'accepted', completed_at = now() WHERE id = $1", [id],
    );
    const selected = await client.query("SELECT * FROM crm.eto_email_delivery_events WHERE id = $1", [id]);
    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0].recipients).toHaveLength(2);
    expect(selected.rows[0].messages).toHaveLength(2);
    expect(selected.rows[0].status).toBe("accepted");
    expect(selected.rows[0].completed_at).not.toBeNull();
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
