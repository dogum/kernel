You are the lead vehicle systems analyst evaluating the uploaded Fleet DNA vehicle-day dataset and its accompanying data dictionary.

MISSION

Determine:

1. What distinct commercial-vehicle duty-cycle archetypes exist?
2. Which operating profiles appear most and least compatible with battery electrification?
3. Which small set of actual vehicle-days should engineers use as representative simulation cases while preserving the observed operational envelope?

Work autonomously in many small notebook cells. Inspect every result before choosing the next step. Do not ask me questions.

Begin by establishing the dataset’s grain, time coverage, identifiers, units, categorical mappings, and feature families. Parse the accompanying data dictionary where needed.

Perform a serious data-quality audit before analysis. Check uniqueness, missingness, sentinel values, impossible ranges, inconsistent percentage totals, sampling coverage, correlated or duplicate features, schema mistakes, and whether missing values are structural or suspicious. Repair only what can be justified and preserve an audit trail.

Build both vehicle-day and vehicle-level analytical tables. Do not randomly split vehicle-days across train and test sets: any validation must be grouped by vehicle to prevent leakage.

Use behavior-derived features—not identifier columns—to:

* Characterize operating intensity, distance, speed, stops, grade, variability, charging opportunity, regenerative-braking opportunity, and power/energy-density demands
* Reduce redundant dimensions and discover stable duty-cycle archetypes
* Select 8–12 actual representative vehicle-days as medoids or nearest real examples
* Test whether operational behavior predicts vocation using grouped validation
* Construct a transparent electrification-suitability screening model with sensitivity analysis

The electrification screen is a comparative engineering screen, not a claim of exact battery energy consumption. Keep any assumed battery capacity, usable fraction, auxiliary load, reserve, efficiency, or charging window explicit and vary them across defensible scenarios.

Identify where conclusions are robust and where they change under alternate assumptions. Treat weak prediction, unstable clusters, or contradictory features as findings rather than hiding them.

Create polished figures showing:

* Data coverage and quality
* The observed duty-cycle operating envelope
* Archetype characteristics and separation
* Electrification suitability by class or vocation
* Sensitivity and uncertainty
* Grouped validation performance and important behavioral features

Produce:

* `VEHICLE_SUMMARY.csv`
* `DUTY_CYCLE_ARCHETYPES.csv`
* `REPRESENTATIVE_DAYS.csv`
* `DATA_QUALITY_REPORT.csv`
* `fleet_dna_analysis.py`
* `REPORT.md`

The report must lead with the decision-relevant findings, explain the archetypes, recommend representative simulation cases, identify promising and difficult electrification profiles, document data limitations, and distinguish measured data from modeled assumptions.

Do not infer present-day fleet adoption or technology performance from this historical dataset. Never invent units or silently interpret an undocumented field.

The final notebook cell must be an actual Markdown cell containing the principal findings, recommended representative cycles, strongest caveat, and artifact list. Printing Markdown from code does not satisfy this requirement.
