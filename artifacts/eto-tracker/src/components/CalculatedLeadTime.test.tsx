import assert from "node:assert/strict";
import React from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CalculatedLeadTime } from "./CalculatedLeadTime";

test("renders the three week estimates, total and rounded quote suggestion", () => {
  const html = renderToStaticMarkup(<CalculatedLeadTime times={{
    design: { value: "1.2" }, procurement: { value: "2.3" }, assembly: { value: "0.7" },
  }} />);
  for (const text of ["Design Time (weeks)", "Procurement Time (weeks)", "Assembly Time (weeks)",
    "Calculated Lead Time", "4.2 weeks", "Generate Quote starts at 5 weeks"]) {
    assert.ok(html.includes(text), text);
  }
});

test("does not render a misleading total for an incomplete review", () => {
  const html = renderToStaticMarkup(<CalculatedLeadTime times={{
    design: { value: "1" }, procurement: { value: "2" }, assembly: {},
  }} />);
  assert.ok(html.includes("Not recorded"));
  assert.ok(html.includes("Not available"));
  assert.ok(!html.includes("Generate Quote starts at"));
});

test("renders loading and failure states explicitly", () => {
  const html = renderToStaticMarkup(<CalculatedLeadTime times={{
    design: { loading: true }, procurement: { error: true }, assembly: { value: "0" },
  }} />);
  assert.ok(html.includes("Loading"));
  assert.ok(html.includes("Could not load"));
});
