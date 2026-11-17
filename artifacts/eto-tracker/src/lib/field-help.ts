/** Helper copy supplied in ETO_helper_text_2.xlsx, grouped by form. */
export const FIELD_HELP = {
  request: {
    "Customer Name": "Customer name",
    "Quote Number": "A quote is required for all ETO requests",
    Distributor: "Is the sale going through a distributor model?",
    "Request Type": "Pick one, if more than one is in the request list in Custom Requests section of application",
    "System Type": "Type of system requested",
    "Expected Force Range": "Maximum force capacity required by customer",
    "Expected Displacement": "Maximum Displacement required by customer",
    "Materials to be Tested": "Material(s) of customer specimens being tested",
    "Specimen Dimensions": "Customer specimen dimensions and gage length requirements",
    "Results Required": "Customer requires custom results? what test result is being tested- strain, force, curve fit or need pass/fail?",
    "Relevant Standard": "Is there a standard that is being tested to - ISO, ASTM, other?",
    "Custom Requests": "Custom request details, overall system requirements and customer facilities impacts including voltage and existing machine information",
    "Customer Budget": "If the customer has budget constraints, estimated customer budget for ETO request",
    "Customer Lead Time": "If the customer has delivery constraints, customer requested leadtime for ETO delivery",
    "Similar Parts or Machines": "Any known part numbers similar too the custom content , Sales orders or quote numbers for reference",
    Attachments: "Attach files for ETO request",
  },
  engineering: {
    "Workflow Actions": "- Complete Engineering : This will open the fields to fill in design hours needed to move to the next stage\n- Re-Assign : This will allow you to move this to another engineer\n- Return to ART : If more information is needed from Sales, this will move the request back to ART",
    "Estimated Design Hours": "Total estimated hours engineering needs to create part numbers, drawings, BOMs for custom content",
    "P/N Guidance": "Any refernce part numbers, reference models or other information for reference if the ETO is won",
    "Risk Score": "- Low : Similar custom designs have been done, smaller custom requirements\n- Med : Maybe have done something like it before, Larger modifications, some issues with past versions\n- High : No similar designs, highly complex, significant issues with past versions",
  },
  production: {
    // The spreadsheet repeated Engineering's actions here. Describe the actual Production controls.
    "Workflow Actions": "- Complete Production : This will open the fields to fill in procurement cost, procurement lead time and assembly hours needed to move to the next stage\n- Re-Assign : This will allow you to move this to another Production reviewer\n- Return : If more information is needed, this will move the request back to Engineering, or ART if Engineering Review is not included",
    "Procurement Cost": "The total of all purchased parts needed, including machining, materials, off the shelf parts vendor price",
    "Procurement Lead Time": "The longest estimated lead time part(s) needed in custom content",
    "Assembly Time": "Estimated assembly time in hours for custom content",
    "Risk Score": "- Low : Similar custom designs have been done, smaller custom requirements\n- Med : Maybe have done something like it before, Larger modifications, some issues with past versions\n- High : No similar designs, highly complex, significant issues with past versions",
  },
} as const;

export type HelpForm = keyof typeof FIELD_HELP;

const aliases: Record<string, string> = {
  "budget range": "customer budget",
  "acceptable lead time": "customer lead time",
  "similar parts / machines": "similar parts or machines",
  "machine type": "system type",
};
const normalize = (field: string) => {
  const key = field.replace(/\s*\((weeks|hours)\)\s*/gi, "").trim().toLowerCase();
  return aliases[key] ?? key;
};

export function getFieldHelp(field: string, form?: HelpForm): string | undefined {
  // Workflow headings are ambiguous and must specify their review form.
  if (!form && normalize(field) === "workflow actions") return undefined;
  const groups = form ? [FIELD_HELP[form]] : Object.values(FIELD_HELP);
  for (const group of groups) {
    const entry = Object.entries(group).find(([name]) => normalize(name) === normalize(field));
    if (entry) return entry[1];
  }
  return undefined;
}
