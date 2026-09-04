"""Reproduce the baseline lunar-settlement launch arithmetic from ASSUMPTIONS.csv."""
import math
import pandas as pd
ITEM_SPECS = [('Pressurized habitat module', 'Habitation', 2, 28.0, False, 'Two independently isolatable volumes'), ('Radiation storm-shelter kit', 'Habitation', 1, 20.0, False, 'Water/polymer shielding; shelter remains usable after module isolation'), ('Airlock and dust-control module', 'Habitation', 2, 8.0, False, 'N+1 airlock path'), ('Thermal-control train', 'Habitation', 3, 4.5, False, '2 required + 1 spare'), ('Life-support processing train', 'Life support', 3, 8.0, False, '2 required + 1 spare'), ('Water-recovery train', 'Life support', 3, 5.0, False, '2 required + 1 spare'), ('Atmosphere storage/control skid', 'Life support', 2, 4.0, False, 'N+1 control and isolation'), ('Waste stabilization unit', 'Life support', 2, 3.5, False, 'N+1 waste path'), ('Solar generation wing', 'Power', 4, 12.0, False, 'Multiple independently switched wings'), ('Battery storage bank', 'Power', 3, 15.0, False, '2 required + 1 spare bank'), ('Emergency fission power unit', 'Power', 2, 20.0, False, 'N+1 emergency units; conceptual mass allowance'), ('Power distribution/microgrid skid', 'Power', 2, 8.0, False, 'N+1 distribution paths'), ('High-gain Earth communications terminal', 'Comms/navigation', 2, 4.0, False, 'N+1 Earth links'), ('Local navigation/relay beacon set', 'Comms/navigation', 2, 2.5, False, 'Redundant local positioning'), ('Compute, control, and timing rack', 'Comms/navigation', 3, 1.5, False, '2 active + 1 cold spare'), ('ISRU volatile-processing train', 'ISRU', 2, 18.0, False, 'One production train plus full spare'), ('Regolith excavator', 'ISRU', 2, 11.0, False, 'N+1 feedstock handling'), ('ISRU product storage skid', 'ISRU', 2, 5.0, False, 'Isolatable duplicate storage'), ('Pressurized surface rover', 'Mobility/deployment', 2, 12.0, False, 'Rescue capability if one rover fails'), ('Unpressurized utility rover', 'Mobility/deployment', 2, 5.0, False, 'N+1 local hauling'), ('Cargo handler/teleloader', 'Mobility/deployment', 2, 9.0, False, 'N+1 unloading and construction'), ('Deployable crane', 'Mobility/deployment', 2, 7.0, False, 'N+1 lift capability'), ('Berm/shielding construction dozer', 'Mobility/deployment', 2, 10.0, False, 'N+1 shielding construction'), ('EVA suit package', 'EVA/tools', 6, 0.35, False, '4 operational + 2 spares'), ('Suit maintenance/charging bench', 'EVA/tools', 2, 1.5, False, 'N+1 service benches'), ('Workshop and additive repair cell', 'EVA/tools', 2, 5.0, False, 'N+1 repair paths'), ('Science/medical laboratory module', 'Medical/science', 1, 10.0, False, 'Includes isolation berth and diagnostics'), ('Medical equipment cache', 'Medical/science', 2, 1.5, False, 'Split caches prevent single loss'), ('Fire suppression/rescue cache', 'Safety', 2, 2.5, False, 'Split emergency caches'), ('Landing-zone and cable kit', 'Site infrastructure', 2, 5.0, False, 'Two separated utility corridors')]

def values(path="ASSUMPTIONS.csv"):
    return pd.read_csv(path).set_index("parameter")["base"].astype(float).to_dict()

def delivered_mass(days=210, policy="no_credit", v=None):
    v = values() if v is None else v
    hardware = sum(q*m for _,_,q,m,_,_ in ITEM_SPECS) * v["hardware_mass_factor"]
    if policy == "no_credit": commission, replacement = math.inf, 0.0
    else:
        prefix = "partial" if policy == "partial" else "mature"
        commission, replacement = v[prefix+"_isru_commission_day"], v[prefix+"_isru_replacement"]
    retained = days - max(0, days-commission)*replacement
    cons = (v["crew_size"]*days*(v["food_rate"]+v["nitrogen_makeup_rate"]+v["hygiene_medical_rate"])
            + v["crew_size"]*retained*(v["water_makeup_rate"]+v["oxygen_makeup_rate"]))/1000 + v["consumables_fixed"]
    subtotal = hardware*(1+v["design_contingency"]+v["general_spares_fraction"]) + cons
    return subtotal*(1+v["packaging_fraction"])*(1+v["integration_margin"])

def crew_load(v):
    priority={"EVA/tools","Medical/science","Comms/navigation","Safety"}
    masses=sorted(m*v["hardware_mass_factor"] for _,cat,q,m,_,_ in ITEM_SPECS if cat in priority for _ in range(int(q)))
    load=0.0
    for mass in masses:
        if load+mass <= v["surface_payload_crew"]+1e-9: load += mass
    return load

def launch_accounting(days=210, policy="no_credit"):
    v=values(); mass=delivered_mass(days,policy,v)
    cargo=math.ceil((mass-crew_load(v))/v["surface_payload_cargo"]-1e-12); crew=int(v["crew_starships"]); lunar=cargo+crew
    prop=v["propellant_per_lunar_ship"]*(1+v["propellant_reserve"])/(1-v["transfer_loss"]-v["boiloff"])
    tankers=math.ceil(lunar*prop/v["tanker_net_propellant"]-1e-12)
    depots=max(math.ceil(prop/v["depot_capacity"]-1e-12), math.ceil(lunar/v["depot_reuse_cycles"]-1e-12))
    return {"delivered_mass_t":mass,"cargo":cargo,"crew":crew,"tankers":tankers,"depots":depots,"total":cargo+crew+tankers+depots}

if __name__ == "__main__": print(launch_accounting())
