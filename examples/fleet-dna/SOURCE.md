# Fleet DNA source and reproduction

The raw source files are intentionally not vendored in this repository. This keeps the example small, avoids copying a 20 MiB public dataset into Git history, and leaves the official license attached to the canonical source.

## Canonical sources

- [Fleet DNA catalog record](https://data.nlr.gov/submissions/42), DOI [`10.7799/1828177`](https://doi.org/10.7799/1828177)
- [Composite vehicle-day CSV](https://www.nlr.gov/media/docs/libraries/transportation/csv/data_for_fleet_dna_composite_data.csv?sfvrsn=8e87517a_1)
- [Fleet DNA data dictionary](https://www.nlr.gov/docs/fy14osti/62572.pdf), DOI [`10.2172/1158422`](https://doi.org/10.2172/1158422)
- [Dataset license](https://data.nlr.gov/node/42/license)

The catalog asks publications to credit the Fleet DNA Project Data and National Renewable Energy Laboratory. Review and comply with the official dataset license before redistributing source data or derived data copies. The example notebook's analysis and conclusions are not endorsed by DOE, NREL/NLR, or Alliance for Sustainable Energy.

## Files used in the captured run

| Filename expected by the notebook | Bytes | SHA-256 |
|---|---:|---|
| `fleet_dna_vehicle_days.csv` | 20,984,870 | `df5798cc8513e6f896fae5488616e39ba341576c4404c4e182ce3795fc3b9d21` |
| `Fleet_DNA_Data_Dictionary.pdf` | 570,117 | `96302e5d4797d81c2be0e7c9a8c5b5ba08d3726ab9d038d46e1d1a3470e4e2ae` |

The hashes document the exact inputs supplied to the captured run; upstream files can change over time.

## Rerun

1. Download the two official source files.
2. Rename the CSV to `fleet_dna_vehicle_days.csv` if the download uses another name.
3. Add both files to the same KERNEL notebook workspace.
4. Open [`result.ipynb`](result.ipynb) and run the cells in order.

The captured environment used pandas 2.3.3, NumPy 2.2.5, matplotlib 3.8.4, SciPy 1.14.1, scikit-learn 1.7.0, and pypdf 6.16.2 under Pyodide 0.29.4 / Python 3.13.2. Small floating-point or clustering-boundary differences are possible under other scientific-Python versions.
