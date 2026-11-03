---
name: Price Calculator percentages
description: Admin defaults initialize editable per-ETO percentages, while saved ETO assumptions remain independent.
---

Contingency and Margin are editable per ETO, not read-only Admin values.
Admin defaults start at 10% Contingency and 55% Margin. Until the first save,
an ETO uses the current defaults; after saving, its percentages belong to that
request and must not be overwritten by later Admin default changes.

**Why:** On 2026-10-02, the user explicitly chose "Editable per ETO, with changes
saved to that request." Global configuration must not silently replace a
reviewer's saved assumptions.

**How to apply:** Treat defaults as starting values rather than live overrides.
Display each review cost in its recorded currency.

## Pricing arithmetic and mixed currencies

Contingency Cost = (Design + Procure + Assembly) × Contingency %.
Margin is additive: (Design + Procure + Assembly + Contingency Cost) × Margin %.
Sales Price is the sum of the three review costs, Contingency Cost, and Margin.
Round source amounts for display/arithmetic and each derived cost line to the
nearest whole number before adding them to the total.

**Why:** On 2026-10-02, the user requested all five monetary values and a Sales
Price total, describing Margin as the cost subtotal plus Margin %. This is an
additive percentage, not a gross-profit-margin division formula.

**How to apply:** Recalculate from the current review costs and editable ETO
percentages. Do not use selling-price division by (1 − Margin %).

Mixed currencies are rare. If they occur, still calculate using the entered
numeric amounts without conversion, and label Contingency Cost, Margin, and
Sales Price "Multi-Currency" so ART Final Review can do its own review.

**Why:** The user explicitly requested this exception instead of blocking totals
or adding exchange-rate conversion, despite selecting the matching-currencies
option in the form.

**How to apply:** Keep the original currency on each source cost. "Multi-Currency"
is a calculated display label, not an ISO currency to store in monetary records.

## Whole-number money

Show all monetary values with a leading currency symbol and no decimal places.
New cost/price inputs and Admin hourly rates must be whole numbers; budgets
may remain ranges of whole amounts. Calculated money rounds half-up using exact
decimal arithmetic. Percentages, hours, and lead times retain their own precision.
Historical records are not bulk-rounded or rewritten.

**Why:** On 2026-10-02, the user requested this convention throughout the app,
including whole-number cost entry and rounded calculated amounts.

**How to apply:** Enforce monetary entry in the UI and API. Preserve currency
codes in storage and histories, and use the recorded currency for symbols.
For mixed-currency totals, retain the explicit Multi-Currency label rather than
inventing a symbol or exchange-rate conversion.

Reject an entire decimal-entry attempt rather than dropping its separator.

**Why:** Browser verification showed that blocking only the decimal point can
turn an attempted `500.5` into `5005`, producing an unintended larger cost.

**How to apply:** Preserve the previous amount on rejected decimal typing or
paste, stop leftover fractional digits from being appended, and allow a fresh
valid whole-number attempt. Test real keyboard entry as well as programmatic fills.

## Review risk display

The Price Calculator also shows the Engineering and Production risk scores
selected on their respective output records. For High risk, show the associated
risk notes. Keep each risk independent and missing historical scores unscored.

**Why:** On 2026-10-02, the user explicitly confirmed both selected review risks
should appear in the Price Calculator; both source Output cards already show
them as well.

**How to apply:** Read risks from the matching Engineering and Production output
records; never derive, merge, or default one review's risk from the other.

## Quote Market Price and calculator independence

ART Final Review starts its quote Market Price from the calculator Sales Price.
ART may manually override the amount or quote currency without changing any
calculator costs, percentages, or calculated results.

**Why:** On 2026-10-02, the user explicitly requested calculator prepopulation
with an independent manual Market Price override.

**How to apply:** Keep the data flow one-way from calculator to quote form.
Untouched quote amounts may follow calculator changes; once manually edited,
do not replace the override with subsequent recalculations. A mixed-currency
calculator label is not a valid stored quote currency; retain an ISO quote
currency and make the need for ART's currency/price review visible.

## Calculated lead time and quote default

Calculated Lead Time is Design Time + Procurement Time + Assembly Time, in
weeks, displayed below the price calculation. Generate Quote initializes Market
Lead Time with the combined total rounded up to the nearest whole week; the
quote field remains an independent editable override.

**Why:** On 2026-10-08, the user requested this exact total and round-up behavior
for Workflow Actions > Generate Quote.

**How to apply:** Use the saved design/assembly week estimates, not their raw
hour inputs or newly changed global formulas. Round only the final sum. Missing
estimates must not silently become zero.