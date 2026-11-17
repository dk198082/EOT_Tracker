import { describe, expect, it } from "vitest";
import { FIELD_HELP, getFieldHelp } from "../../../../eto-tracker/src/lib/field-help";

describe("spreadsheet field help", () => {
  it("provides all 25 entries across the three forms", () => {
    expect(Object.values(FIELD_HELP).reduce((count, fields) => count + Object.keys(fields).length, 0)).toBe(25);
    for (const [form, fields] of Object.entries(FIELD_HELP)) {
      for (const [field, text] of Object.entries(fields)) {
        expect(getFieldHelp(field, form as keyof typeof FIELD_HELP)).toBe(text);
      }
    }
  });

  it("maps renamed fields, case differences and unit suffixes without changing labels", () => {
    expect(getFieldHelp("Budget Range", "request")).toBe(getFieldHelp("Customer Budget", "request"));
    expect(getFieldHelp("Acceptable Lead Time (weeks)", "request")).toBe(getFieldHelp("Customer Lead Time", "request"));
    expect(getFieldHelp("Machine Type")).toBe(getFieldHelp("System Type"));
    expect(getFieldHelp("Similar Parts / Machines")).toBe(getFieldHelp("Similar Parts or Machines"));
    expect(getFieldHelp("Estimated Design hours")).toBe(FIELD_HELP.engineering["Estimated Design Hours"]);
    expect(getFieldHelp("Procurement Lead Time (weeks)")).toBe(FIELD_HELP.production["Procurement Lead Time"]);
    expect(getFieldHelp("Assembly Time (hours)")).toBe(FIELD_HELP.production["Assembly Time"]);
  });

  it("keeps workflow actions department-specific and ignores fields without supplied help", () => {
    expect(getFieldHelp("Workflow Actions")).toBeUndefined();
    expect(getFieldHelp("Workflow Actions", "engineering")).toContain("another engineer");
    expect(getFieldHelp("Workflow Actions", "production")).toContain("another Production reviewer");
    expect(getFieldHelp("Notes")).toBeUndefined();
    expect(getFieldHelp("Risk Score", "engineering")).toBe(getFieldHelp("Risk Score", "production"));
  });
});
