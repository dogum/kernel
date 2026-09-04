You are operating autonomously in a Jupyter notebook running Pyodide in the browser. There is no internet, no subprocesses, and no native compiler. Python stdlib, numpy, matplotlib, and any empirically importable Pyodide packages are available.

GOAL

Estimate how many Earth-origin Starship/Super Heavy launches are required for the one-time buildup of a four-person lunar south-pole settlement that can remain safely occupied for 180 days with zero resupply.

Count every required Starship launch: lunar cargo vehicles, LEO tanker flights, orbital depot launches, and crew Starships if your architecture uses them. If crew arrives through a non-Starship system, disclose that dependency and report both the Starship total and the all-launch-vehicle total.

Do not count Earth-side infrastructure, development or certification flights, or any resupply after occupancy begins.

The Starship, tanker, and depot vehicle dry masses are not part of the delivered settlement inventory. Their launches still count. Surface mobility vehicles, cargo-handling equipment, and construction machinery are settlement infrastructure and do count.

SURVIVAL STANDARD

The settlement must provide:

* Pressurized habitation, thermal control, radiation protection, and life support
* Food, water, oxygen, atmospheric makeup, hygiene, medical supplies, and waste handling
* Surface power generation, storage, distribution, and emergency backup
* Communications, navigation, EVA equipment, tools, spares, and maintenance capability
* ISRU equipment, feedstock handling, processing, and product storage
* Surface mobility and cargo deployment equipment
* N+1 resilience for life-critical functions, or an explicitly justified alternative

Calculate the strict 180-day requirement and a separate resilient case with 30 additional days of consumable reserve.

Do not allow ISRU to erase initial survival consumables by assumption. Model at least:

1. No ISRU credit during the first 180 days
2. Partial ISRU credit after commissioning and demonstrated production
3. An optimistic mature-ISRU case

METHOD

Work in many small notebook cells. After every cell, inspect the actual output before deciding what to do next.

1. Probe the environment and print a short capability table.
2. Create an assumptions registry with parameter, unit, low/base/high values, rationale, and whether it is a known input or an engineering assumption.
3. Build a bottom-up settlement mass budget. Include subsystem mass, contingency, spares, consumables, packaging, and integration margin.
4. Build an explicit transportation model with uncertain parameters for:

   * Lunar-surface payload per cargo Starship
   * Net propellant delivered per tanker flight
   * Propellant required per lunar-bound Starship
   * Transfer loss, boiloff, reserve, depot capacity, and depot reuse
5. Use integer launch accounting. Show the arithmetic separately for depot, tanker, cargo, and crew launches. Never report a fractional launch.
6. Construct a flight-by-flight cargo manifest. Do not assume every item is infinitely divisible or that aggregate mass alone guarantees packability.
7. Evaluate conservative, baseline, and optimistic scenarios.
8. Run at least 20,000 seeded Monte Carlo cases over the uncertain assumptions. Report the launch-count distribution and P10/P50/P90 values.
9. Identify the assumptions that move the answer across an integer launch boundary. Produce a tornado chart or equivalent sensitivity ranking.
10. Verify the model with automated checks:

    * Subsystem masses reconcile to the total
    * Manifested mass never exceeds flight capacity
    * Launch categories sum to the headline total
    * Increasing payload capacity cannot increase required launches
    * Increasing crew size or duration cannot reduce required mass
    * Tanker propellant and settlement cargo are not double-counted

If a check fails, print the failure, diagnose it, repair the model, and rerun it.

DELIVERABLES

Create:

* `ASSUMPTIONS.csv`
* `LAUNCH_MANIFEST.csv`
* `lunar_settlement_model.py`
* `REPORT.md`
* A mass-budget figure
* A launch-stack breakdown
* A launch-count uncertainty distribution
* A sensitivity figure

Lead the report with a decision-style answer:

“Baseline: X successful Starship launches = A cargo/crew Starships + B tanker flights + C depot launches. Plausible range: Y–Z.”

Also report infrastructure-only and crew-inclusive totals, the strict 180-day and 30-day-reserve cases, the top five drivers, and what evidence would most reduce uncertainty.

Separate “planned successful launches” from any optional calculation of expected launch attempts under an assumed failure rate.

Do not invent citations or present remembered vehicle specifications as verified facts. Unknown Starship performance values must remain visible assumptions. Avoid false precision.

The final notebook cell must be an actual Markdown cell containing the headline answer, launch arithmetic, uncertainty range, and dominant caveat. Printing or displaying Markdown from a code cell does not satisfy this requirement. Also save the complete report as `REPORT.md`.

Do not ask me questions. Make defensible assumptions, record them, test them, and continue until the artifacts and final Markdown cell are complete.
