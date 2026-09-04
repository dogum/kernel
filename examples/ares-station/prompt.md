# Autonomous Notebook Challenge: Build a Mars Colony Operations Intelligence System

You are operating autonomously inside a completely blank Python notebook running **Pyodide in the browser**.

Your goal is not merely to answer a question. Your goal is to demonstrate the full capability of this agent harness by completing a substantial, multi-stage technical project through repeated reasoning, Python execution, inspection of results, debugging, refinement, visualization, and validation.

## Mission

You are the lead data scientist and operations engineer for **Ares Station**, a simulated Mars colony with 120 residents.

Build an end-to-end **Mars Colony Operations Intelligence System** that can:

1. simulate realistic colony operations,
2. discover operational problems from the data,
3. diagnose likely root causes,
4. forecast resource risks,
5. optimize operational decisions,
6. stress-test those decisions,
7. communicate the results through strong visualizations and an executive report.

Do the work yourself autonomously. Do not ask me what to do next.

---

## Environment constraints

You are running in a browser under Pyodide.

Assume:

* no shell or subprocesses,
* no local machine access,
* no external filesystem beyond whatever the notebook exposes,
* network access may be unavailable or restricted,
* packages may or may not already be installed.

Start by programmatically inspecting what capabilities and useful Python packages are available.

Prefer standard-library Python plus commonly available Pyodide packages such as NumPy, pandas, matplotlib, scipy, or scikit-learn if present.

If a desired package is missing, either:

* install it with `micropip` if practical, or
* implement a reasonable alternative yourself.

Do not abandon the mission because a package is unavailable.

---

# Phase 1 — Reconnaissance

Inspect the Python environment.

Determine:

* Python version,
* available numerical/data libraries,
* visualization capabilities,
* whether scipy/sklearn or similar libraries are present,
* anything else relevant to the project.

Then state a concise execution plan and begin immediately.

Do not merely describe code you would write. Execute it.

---

# Phase 2 — Create the colony digital twin

Generate a reproducible synthetic dataset covering **180 Martian days** at hourly resolution.

Use a fixed random seed.

Model at least these systems:

* solar power generation,
* battery state of charge,
* habitat electricity demand,
* oxygen production,
* oxygen reserves,
* water extraction,
* water reserves,
* greenhouse food production,
* indoor temperature,
* external temperature,
* CO₂ concentration,
* equipment vibration,
* communications quality,
* crew activity level.

Include realistic relationships such as:

* solar production depending on time of day and dust conditions,
* battery charge responding to generation and demand,
* oxygen consumption depending on crew activity,
* greenhouse productivity responding to light and temperature,
* equipment vibration changing as machinery degrades,
* resource reserves accumulating and depleting over time.

Inject several **hidden operational events**, such as:

* a prolonged dust storm,
* gradual degradation of an oxygen generator,
* an intermittent water extraction failure,
* abnormal vibration preceding an equipment fault,
* unusual power consumption from one subsystem,
* a communications outage,
* at least one subtle problem that is difficult to detect using simple thresholds.

Make the simulation internally coherent rather than generating independent random columns.

Create any additional tables you need, such as:

* equipment metadata,
* maintenance history,
* subsystem power consumption,
* crew schedule,
* fault logs.

---

# Phase 3 — Exploratory data forensics

Now pretend you are receiving this dataset as an operations analyst.

Explore it systematically.

Do not assume the injected events are the only interesting patterns.

Investigate:

* distributions,
* missing values,
* correlations,
* trends,
* seasonality,
* lag relationships,
* resource balances,
* suspicious periods,
* sensor inconsistencies.

Create informative visualizations.

At minimum produce:

1. a colony-wide operations overview,
2. a resource reserve plot,
3. a power generation/demand/battery plot,
4. an environmental plot,
5. a correlation or dependency visualization,
6. at least one plot specifically designed to reveal a subtle anomaly.

When a visualization reveals something interesting, inspect it further rather than blindly continuing through a checklist.

---

# Phase 4 — Autonomous anomaly detection

Implement more than one anomaly-detection strategy.

For example:

* robust z-scores / MAD,
* rolling residual detection,
* multivariate distance,
* PCA-based reconstruction error,
* Isolation Forest if available,
* change-point-like logic,
* custom engineering-domain rules.

Compare the approaches.

Identify the most important anomaly periods and rank them by operational severity.

For each major anomaly:

* state when it happened,
* show which variables changed,
* quantify the evidence,
* propose a likely root cause,
* estimate confidence in that diagnosis.

Create a concise anomaly table.

---

# Phase 5 — Predictive maintenance

Determine whether any equipment signal provides advance warning of failure.

Engineer useful features from the vibration and operational data.

Build a model that estimates something useful such as:

* probability of equipment failure in the next 24–72 hours,
* remaining useful life,
* or an equivalent predictive-maintenance score.

Use a time-aware train/test procedure rather than randomly leaking future information into the training set.

Compare the predictive model against a simple baseline.

Report appropriate metrics.

Inspect where the model fails and improve it at least once if there is an obvious opportunity.

---

# Phase 6 — Resource forecasting

Forecast at least:

* battery state,
* oxygen reserves,
* water reserves,

over a meaningful future horizon.

You may use statistical models, regression, smoothing, autoregression, simulation, or another defensible method.

Provide uncertainty estimates or scenario bands rather than only point estimates.

Answer operational questions such as:

* Under normal conditions, which resource is closest to becoming critical?
* What happens if another dust storm begins tomorrow?
* How many hours/days of safety margin remain?

---

# Phase 7 — Optimization problem

Create and solve a realistic colony operations optimization problem.

For example, choose hourly operating levels for:

* oxygen production,
* water extraction,
* greenhouse lighting,
* battery charging/discharging,
* nonessential scientific equipment,

subject to constraints involving:

* power availability,
* minimum oxygen reserve,
* minimum water reserve,
* battery limits,
* crew needs,
* equipment operating limits.

Construct a meaningful objective such as minimizing:

* risk,
* energy curtailment,
* resource shortage,
* equipment wear,

or a weighted combination.

If scipy optimization is available, use it where appropriate.

Otherwise implement a heuristic, dynamic-programming method, search method, or custom optimizer.

Compare the optimized schedule against a naive baseline.

Quantify the improvement.

---

# Phase 8 — Monte Carlo stress test

Do not trust the optimized solution immediately.

Run a Monte Carlo simulation with at least several hundred scenarios in which uncertain factors vary, including some combination of:

* solar generation,
* dust-storm duration,
* demand,
* equipment efficiency,
* water availability,
* oxygen consumption.

Estimate:

* probability of oxygen shortage,
* probability of water shortage,
* probability of battery depletion,
* worst credible outcome,
* expected safety margin.

If the optimized strategy is fragile, revise it and rerun the stress test.

Demonstrate an iterative improvement rather than presenting the first answer as automatically correct.

---

# Phase 9 — Build a colony health score

Design an interpretable **Colony Health Index** from 0–100.

It should combine multiple dimensions such as:

* energy security,
* life-support reserves,
* environmental safety,
* equipment health,
* communications,
* operational resilience.

Explain the weighting.

Calculate the index through time.

Identify the five lowest-scoring periods and explain why they were dangerous.

Plot the score with major events annotated.

---

# Phase 10 — Verification and adversarial self-check

Before concluding, actively try to prove your own work wrong.

Check for issues such as:

* impossible resource values,
* energy conservation mistakes,
* target leakage,
* accidental use of future information,
* misleading metrics,
* numerical instability,
* incorrect optimization constraints,
* anomalies caused solely by your simulation implementation,
* conclusions unsupported by the data.

Write automated assertions/tests for important assumptions.

If you discover a flaw, fix it and rerun the affected analysis.

Do not hide failed approaches or errors. Briefly explain meaningful corrections.

---

# Phase 11 — Final command-center report

Finish with a polished report suitable for the colony commander.

Include:

## Executive status

A short assessment of whether the colony is currently safe.

## Top 5 findings

Ranked by importance.

## Detected incidents

Include dates/times, evidence, root-cause hypotheses, and confidence.

## Predictive maintenance

Explain which equipment is most at risk and how early the warning system can detect it.

## Resource outlook

Give expected safety margins for energy, oxygen, and water.

## Recommended operating plan

Describe what operational changes should be made.

## Stress-test results

Summarize failure probabilities before and after optimization.

## Colony Health Index

Report the final score and what drives it.

## Next actions

Provide 3–7 concrete recommendations.

---

# Harness-behavior requirements

This challenge is also testing your ability to operate as an autonomous notebook agent.

Therefore:

* Use many notebook execution steps rather than generating one giant script and stopping.
* Inspect outputs after important computations.
* Let intermediate results influence later decisions.
* Debug errors yourself.
* Revise your approach when evidence warrants it.
* Keep useful state in notebook variables.
* Prefer reusable functions over repeated code.
* Add automated checks for important calculations.
* Produce several polished plots.
* Print concise checkpoints so I can follow your progress.
* Do not ask me for permission between phases.
* Do not stop after merely creating the dataset.
* Do not substitute prose for computation when computation is possible.
* Avoid fake results: every numerical claim in the final report should come from executed calculations.
* If something cannot be done because of Pyodide limitations, explain the limitation, devise the best browser-compatible alternative, and continue.

Treat unexpected exceptions, unavailable packages, strange model results, and failed assumptions as opportunities to demonstrate autonomous recovery.

Your final output should make it obvious that you did much more than run a single Python cell.

Begin now.
