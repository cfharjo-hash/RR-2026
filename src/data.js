// All game content is data — the sim reads it, so the tree can grow without code changes.
//
// Cargo is counted in real units. `wt` = tons per unit (train weight), `cap` = units per wagon
// for each wagon type that can carry it (the first listed is the proper wagon), `store` = the
// kind of storage it needs at a station. Raw goods have a base `value` per unit; every product's
// value is derived from its recipe (see deriveValues below), so it always rises up the chain.

// ======== the classic rule set (the original map's tree; old saves use it) ========
const CLASSIC_CARGO = {
  passengers:  { name: 'Passengers',  unit: 'pax',    wt: 0.08, cap: { coach: 40, cabin: 12 },               value: 65, store: 'pax',    tier: 0, color: '#e8d7a9', speedy: true },
  mail:        { name: 'Mail',        unit: 'bags',   wt: 0.03, cap: { van: 150, coach: 20, mailbay: 120 },     value: 15,  store: 'pax',    tier: 0, color: '#c9473d', speedy: true },
  grain:       { name: 'Grain',       unit: 't',      wt: 1, cap: { hopper: 26, box: 18 },        value: 60,  store: 'bulk',   tier: 0, color: '#e3c15a' },
  livestock:   { name: 'Livestock',   unit: 'head',   wt: 0.5, cap: { stock: 24 },                value: 90,  store: 'pen',    tier: 0, color: '#a2643a' },
  logs:        { name: 'Logs',        unit: 't',      wt: 1, cap: { flat: 22 },                   value: 45,  store: 'bulk',   tier: 0, color: '#7a5532' },
  coal:        { name: 'Coal',        unit: 't',      wt: 1, cap: { hopper: 30 },                 value: 50,  store: 'bulk',   tier: 0, color: '#2b2b2b' },
  iron_ore:    { name: 'Iron Ore',    unit: 't',      wt: 1, cap: { hopper: 32 },                 value: 55,  store: 'bulk',   tier: 0, color: '#8f4a37' },
  copper_ore:  { name: 'Copper Ore',  unit: 't',      wt: 1, cap: { hopper: 30 },                 value: 80,  store: 'bulk',   tier: 0, color: '#4f8f7a' },
  stone:       { name: 'Stone',       unit: 't',      wt: 1, cap: { hopper: 30, flat: 22 },       value: 30,  store: 'bulk',   tier: 0, color: '#9a9a94' },
  sand:        { name: 'Sand',        unit: 't',      wt: 1, cap: { hopper: 30 },                 value: 20,  store: 'bulk',   tier: 0, color: '#dcc58d' },
  clay:        { name: 'Clay',        unit: 't',      wt: 1, cap: { hopper: 28 },                 value: 22,  store: 'bulk',   tier: 0, color: '#b4734d' },
  cotton:      { name: 'Cotton',      unit: 'bales',  wt: 0.25, cap: { box: 60 },                 value: 40,  store: 'goods',  tier: 0, color: '#f3f1ea' },
  crude:       { name: 'Crude Oil',   unit: 't',      wt: 1, cap: { tank: 28, box: 12 },          value: 120, store: 'liquid', tier: 0, color: '#1c1a17', year: 1860 },
  rubber:      { name: 'Rubber',      unit: 't',      wt: 1, cap: { box: 16 },                    value: 400, store: 'goods',  tier: 0, color: '#5b4a3a', year: 1890 },

  planks:      { name: 'Planks',      unit: 't',      wt: 1, cap: { flat: 22, box: 18 },          store: 'bulk',   tier: 1, color: '#c9a067' },
  steel:       { name: 'Steel',       unit: 't',      wt: 1, cap: { flat: 25 },                   store: 'bulk',   tier: 1, color: '#8d98a3' },
  copper:      { name: 'Copper',      unit: 't',      wt: 1, cap: { flat: 25 },                   store: 'bulk',   tier: 1, color: '#c87533' },
  cement:      { name: 'Cement',      unit: 't',      wt: 1, cap: { hopper: 28, box: 16 },        store: 'bulk',   tier: 1, color: '#bdbdb5' },
  bricks:      { name: 'Bricks',      unit: 'pallets', wt: 1, cap: { flat: 24, box: 18 },         store: 'bulk',   tier: 1, color: '#a8432e' },
  glass:       { name: 'Glass',       unit: 'crates', wt: 0.3, cap: { box: 40 },                  store: 'goods',  tier: 1, color: '#9fd3df' },
  flour:       { name: 'Flour',       unit: 't',      wt: 1, cap: { box: 18, hopper: 22 },        store: 'goods',  tier: 1, color: '#f0e6d2' },
  meat:        { name: 'Meat',        unit: 't',      wt: 1, cap: { reefer: 16, box: 10 },        store: 'cold',   tier: 1, color: '#c2414b', perish: true },
  leather:     { name: 'Leather',     unit: 't',      wt: 1, cap: { box: 14 },                    store: 'goods',  tier: 1, color: '#6e4024' },
  textiles:    { name: 'Textiles',    unit: 't',      wt: 1, cap: { box: 14 },                    store: 'goods',  tier: 1, color: '#8e5ab8' },
  fuel:        { name: 'Fuel',        unit: 't',      wt: 1, cap: { tank: 28, box: 12 },          store: 'liquid', tier: 1, color: '#d7a12a', year: 1860 },
  tyres:       { name: 'Tyres',       unit: 't',      wt: 1, cap: { box: 10 },                    store: 'goods',  tier: 1, color: '#333333', year: 1895 },
  plastics:    { name: 'Plastics',    unit: 't',      wt: 1, cap: { box: 15 },                    store: 'goods',  tier: 1, color: '#5aa1e0', year: 1910 },

  food:        { name: 'Food',        unit: 't',      wt: 1, cap: { reefer: 16, box: 12, cargobay: 3 },        store: 'cold',   tier: 2, color: '#e9853b', perish: true },
  tools:       { name: 'Tools',       unit: 'crates', wt: 0.2, cap: { box: 60, cargobay: 20 },                  store: 'goods',  tier: 2, color: '#5d6d7e' },
  machinery:   { name: 'Machinery',   unit: 'units',  wt: 4, cap: { flat: 5 },                    store: 'goods',  tier: 2, color: '#3f6fb3' },
  clothing:    { name: 'Clothing',    unit: 'crates', wt: 0.1, cap: { box: 120, cargobay: 50 },                 store: 'goods',  tier: 2, color: '#d564a6' },
  furniture:   { name: 'Furniture',   unit: 'pieces', wt: 0.08, cap: { box: 90 },                 store: 'goods',  tier: 2, color: '#9b6b43' },
  construction:{ name: 'Constr. Materials', unit: 't', wt: 1, cap: { flat: 24 },                  store: 'bulk',   tier: 2, color: '#d0b06a' },
  electronics: { name: 'Electronics', unit: 'crates', wt: 0.05, cap: { box: 200, cargobay: 80 },                store: 'goods',  tier: 2, color: '#3fc2b0', year: 1925 },
  automobiles: { name: 'Automobiles', unit: 'cars',   wt: 1.3, cap: { autorack: 8, flat: 2 },     store: 'goods',  tier: 3, color: '#b0302a', year: 1905 },
};

// Rolling stock. `year` = when it becomes available; cost in 1850 dollars (inflates).
export const WAGONS = {
  coach:    { name: 'Passenger coach',   year: 1850, tare: 18, cost: 6000 },
  van:      { name: 'Mail van',          year: 1850, tare: 12, cost: 4000 },
  box:      { name: 'Boxcar',            year: 1850, tare: 12, cost: 4500 },
  hopper:   { name: 'Open hopper',       year: 1850, tare: 11, cost: 4000 },
  flat:     { name: 'Flatcar',           year: 1850, tare: 9,  cost: 3500 },
  stock:    { name: 'Stock car',         year: 1855, tare: 12, cost: 4200 },
  tank:     { name: 'Tank car',          year: 1865, tare: 14, cost: 6000 },
  reefer:   { name: 'Refrigerated car',  year: 1880, tare: 16, cost: 7500 },
  autorack: { name: 'Car carrier',       year: 1910, tare: 16, cost: 9000 },
  // aircraft compartments (planes only)
  cabin:    { name: 'Passenger cabin',   year: 9999, tare: 0, cost: 0, air: true },
  mailbay:  { name: 'Mail compartment',  year: 9999, tare: 0, cost: 0, air: true },
  cargobay: { name: 'Cargo hold',        year: 9999, tare: 0, cost: 0, air: true },
  // road vehicle bodies (road vehicles only; capacities derived below)
  stage:     { name: 'Coach body',        year: 9999, tare: 0, cost: 0, road: true },
  cart:      { name: 'Freight cart',      year: 9999, tare: 0, cost: 0, road: true },
  lorry:     { name: 'Lorry body',        year: 9999, tare: 0, cost: 0, road: true },
  tanklorry: { name: 'Tank body',         year: 9999, tare: 0, cost: 0, road: true },
  bus:       { name: 'Bus body',          year: 9999, tare: 0, cost: 0, road: true },
};
// Towns consume these (they also produce passengers & mail)
const CLASSIC_TOWN_ACCEPTS = ['passengers', 'mail', 'food', 'clothing', 'construction', 'fuel', 'furniture', 'electronics', 'tools', 'automobiles'];
// Deliveries that make towns grow (growth points per wagonload)
const CLASSIC_TOWN_GROWTH = { food: 3, construction: 4, clothing: 2, furniture: 2, electronics: 3, fuel: 2, tools: 1, automobiles: 4, passengers: 0.5, mail: 0.5 };
// Monthly town demand per 1,000 people (units) — supplying beyond this lowers the price
const CLASSIC_TOWN_DEMAND = { food: 6, clothing: 30, construction: 8, fuel: 5, furniture: 20, electronics: 40, tools: 15, automobiles: 1, passengers: 1e9, mail: 1e9 };

// Industries. Raw: `out` = units / month at level 1. Processing: `in`/`out` = units per batch,
// `cap` = max batches / month. `boost`: delivering this to the industry raises output.
// `markup` multiplies input value to give output value. `year` = founded in that year.
const CLASSIC_INDUSTRY = {
  // ---------- raw ----------
  coal_mine:    { name: 'Coal Mine',      kind: 'mine',   tier: 0, out: { coal: 160 },       boost: { machinery: 0.5 }, count: 3, terrain: 'hill' },
  iron_mine:    { name: 'Iron Mine',      kind: 'mine',   tier: 0, out: { iron_ore: 150 },   boost: { machinery: 0.5 }, count: 2, terrain: 'hill' },
  copper_mine:  { name: 'Copper Mine',    kind: 'mine',   tier: 0, out: { copper_ore: 120 }, boost: { machinery: 0.5 }, count: 2, terrain: 'hill' },
  quarry:       { name: 'Stone Quarry',   kind: 'pit',    tier: 0, out: { stone: 150 },      boost: { machinery: 0.4 }, count: 2, terrain: 'hill' },
  sand_pit:     { name: 'Sand Pit',       kind: 'pit',    tier: 0, out: { sand: 150 },       boost: { tools: 0.3 },     count: 1, terrain: 'low' },
  clay_pit:     { name: 'Clay Pit',       kind: 'pit',    tier: 0, out: { clay: 140 },       boost: { tools: 0.3 },     count: 1, terrain: 'low' },
  lumber_camp:  { name: 'Lumber Camp',    kind: 'lumber', tier: 0, out: { logs: 130 },       boost: { tools: 0.4 },     count: 3, terrain: 'forest' },
  grain_farm:   { name: 'Grain Farm',     kind: 'farm',   tier: 0, out: { grain: 140 },      boost: { tools: 0.3, machinery: 0.3 }, count: 3, terrain: 'flat' },
  ranch:        { name: 'Cattle Ranch',   kind: 'ranch',  tier: 0, out: { livestock: 90 },   boost: { tools: 0.3 },     count: 2, terrain: 'flat' },
  cotton_farm:  { name: 'Cotton Plantation', kind: 'farm', tier: 0, out: { cotton: 300 },    boost: { tools: 0.3 },     count: 2, terrain: 'flat', field: '#efeee6' },
  oil_well:     { name: 'Oil Wells',      kind: 'well',   tier: 0, out: { crude: 120 },      boost: { machinery: 0.5 }, count: 2, terrain: 'any', year: 1860 },
  rubber_farm:  { name: 'Rubber Plantation', kind: 'farm', tier: 0, out: { rubber: 50 },     boost: { tools: 0.3 },     count: 1, terrain: 'flat', field: '#4f6b3a', year: 1890 },

  // ---------- tier 1 ----------
  sawmill:        { name: 'Sawmill',        kind: 'factory', tier: 1, in: { logs: 1.3 },                  out: { planks: 1 },  cap: 120, count: 2, style: { hall: '#8a6a45', roof: '#5a4632', stacks: 1 } },
  steel_mill:     { name: 'Steel Mill',     kind: 'factory', tier: 1, in: { iron_ore: 1.5, coal: 0.9 },   out: { steel: 1 },   cap: 100, count: 2, style: { hall: '#6b5d55', roof: '#3c3836', stacks: 4, big: true } },
  copper_smelter: { name: 'Copper Smelter', kind: 'factory', tier: 1, in: { copper_ore: 3, coal: 0.6 },   out: { copper: 1 },  cap: 40,  count: 1, style: { hall: '#7a6250', roof: '#4b6b5f', stacks: 2 } },
  cement_works:   { name: 'Cement Works',   kind: 'factory', tier: 1, in: { stone: 1.3, coal: 0.3 },      out: { cement: 1 },  cap: 120, count: 1, style: { hall: '#b8b4a8', roof: '#8c887d', stacks: 2, silos: 3 } },
  brickworks:     { name: 'Brickworks',     kind: 'factory', tier: 1, in: { clay: 1.1, coal: 0.15 },      out: { bricks: 1 },  cap: 120, count: 1, style: { hall: '#9c4733', roof: '#4c3a33', stacks: 3 } },
  glassworks:     { name: 'Glassworks',     kind: 'factory', tier: 1, in: { sand: 1, coal: 0.3 },         out: { glass: 1 },   cap: 150, count: 1, style: { hall: '#a9a294', roof: '#4b5a66', stacks: 1, cone: true } },
  flour_mill:     { name: 'Flour Mill',     kind: 'factory', tier: 1, in: { grain: 1.3 },                 out: { flour: 1 },   cap: 100, count: 1, style: { hall: '#d8cbb0', roof: '#7a5a3a', stacks: 0, silos: 4 } },
  slaughterhouse: { name: 'Slaughterhouse', kind: 'factory', tier: 1, in: { livestock: 3 },               out: { meat: 1, leather: 0.15 }, cap: 30, count: 1, style: { hall: '#c8b9a6', roof: '#6d3b32', stacks: 1 } },
  textile_mill:   { name: 'Textile Mill',   kind: 'factory', tier: 1, in: { cotton: 5 },                  out: { textiles: 1 }, cap: 60, count: 1, style: { hall: '#a4553f', roof: '#3f3a3a', stacks: 1, saw: true } },
  refinery:       { name: 'Oil Refinery',   kind: 'factory', tier: 1, in: { crude: 1.25 },                out: { fuel: 1 },    cap: 100, count: 1, year: 1860, style: { hall: '#9a9a96', roof: '#6c6c69', stacks: 2, tanks: 4 } },
  tyre_factory:   { name: 'Tyre Factory',   kind: 'factory', tier: 1, in: { rubber: 0.6, coal: 0.2 },     out: { tyres: 1 },   cap: 40,  count: 1, year: 1895, style: { hall: '#5f5f63', roof: '#2a2a2c', stacks: 2 } },
  chemical_plant: { name: 'Chemical Plant', kind: 'factory', tier: 1, in: { crude: 1.5, coal: 0.5 },      out: { plastics: 1 }, cap: 60, count: 1, year: 1910, style: { hall: '#c2c6c4', roof: '#5f7a7f', stacks: 2, tanks: 2 } },

  // ---------- tier 2 ----------
  food_plant:        { name: 'Food Processing Plant', kind: 'factory', tier: 2, in: { flour: 0.6, meat: 0.5 },    out: { food: 1 },        cap: 60,  count: 1, style: { hall: '#e0d6c4', roof: '#a04a3a', stacks: 1, silos: 2 } },
  tool_works:        { name: 'Tool Works',      kind: 'factory', tier: 2, in: { steel: 0.15, planks: 0.08 },    out: { tools: 1 },       cap: 400, count: 1, style: { hall: '#7c6e64', roof: '#394552', stacks: 2, saw: true } },
  machine_factory:   { name: 'Machine Factory', kind: 'factory', tier: 2, in: { steel: 2.5, copper: 0.6 },      out: { machinery: 1 },   cap: 25,  count: 1, style: { hall: '#6f7f8c', roof: '#2f3d4c', stacks: 3, saw: true, big: true } },
  garment_factory:   { name: 'Garment Factory', kind: 'factory', tier: 2, in: { textiles: 0.12, leather: 0.02 }, out: { clothing: 1 },    cap: 300, count: 1, style: { hall: '#c7a28f', roof: '#55406a', stacks: 1 } },
  furniture_factory: { name: 'Furniture Factory', kind: 'factory', tier: 2, in: { planks: 0.15, textiles: 0.03 }, out: { furniture: 1 }, cap: 300, count: 1, style: { hall: '#b48a5e', roof: '#4a3b2c', stacks: 1 } },
  building_yard:     { name: 'Building Materials Yard', kind: 'factory', tier: 2, in: { cement: 0.4, bricks: 0.5, planks: 0.1, glass: 0.3 }, out: { construction: 1 }, cap: 150, count: 1, style: { hall: '#a8a08a', roof: '#6a5d4b', stacks: 0, silos: 2 } },
  electronics_plant: { name: 'Electronics Plant', kind: 'factory', tier: 2, in: { copper: 0.02, plastics: 0.02, glass: 0.05 }, out: { electronics: 1 }, cap: 600, count: 1, year: 1925, style: { hall: '#e4e6e8', roof: '#3a7f9a', stacks: 0, saw: true } },

  // ---------- tier 3 ----------
  auto_plant:        { name: 'Automobile Works', kind: 'factory', tier: 3, in: { steel: 0.9, tyres: 0.12, glass: 1, machinery: 0.05 }, out: { automobiles: 1 }, cap: 30, count: 1, year: 1905, style: { hall: '#d6d2c8', roof: '#7a2a24', stacks: 2, saw: true, big: true } },
};

const MARKUP = [1, 1.6, 2.5, 4];
// the rule set in play (filled by useRules before a map is made): the sim reads these
export const CARGO = {}, INDUSTRY = {}, TOWN_GROWTH = {}, TOWN_DEMAND = {};
export const TOWN_ACCEPTS = [];
export const RULES = { name: null };

// Value per unit (1850 dollars) for every cargo; products derive from their recipe inputs.
export function deriveValues() {
  for (let pass = 0; pass < 6; pass++) for (const def of Object.values(INDUSTRY)) {
    if (!def.in || !Object.keys(def.out).length) continue; // (customers only buy)
    const outs = Object.entries(def.out), main = outs[0][0];
    if (Object.keys(def.in).some(c => CARGO[c].value === undefined)) continue;
    const inputs = Object.entries(def.in).reduce((s, [c, q]) => s + q * CARGO[c].value, 0);
    // by-products (e.g. leather) take a small share at a fixed rate
    const byShare = outs.slice(1).reduce((s, [, q]) => s + q * 0.6, 0);
    CARGO[main].value = Math.round(inputs * MARKUP[def.tier] / (outs[0][1] + byShare) * 100) / 100;
    for (const [c, q] of outs.slice(1)) CARGO[c].value = Math.round(CARGO[main].value * 0.6 * 100) / 100;
  }
}

// Locomotives unlock by year (era progression). power = tons it can pull up a grade comfortably / 100.
export const LOCOS = [
  { id: 'comet',   name: 'Comet 4-4-0',          year: 1850, speed: 34, power: 1.0, cost: 42000, upkeep: 5000, maxCars: 4, color: '#2f5d3a', trim: '#b8332b' },
  { id: 'mogul',   name: 'Hauler 2-6-0',         year: 1850, speed: 28, power: 1.7, cost: 58000, upkeep: 6500, maxCars: 6, color: '#2c2c30', trim: '#b28a2c' },
  { id: 'express', name: 'Meridian 4-4-2',       year: 1858, speed: 50, power: 1.3, cost: 85000, upkeep: 8000, maxCars: 5, color: '#5a2324', trim: '#d4b25a' },
  { id: 'consol',  name: 'Ironside 2-8-0',       year: 1865, speed: 40, power: 2.4, cost: 96000, upkeep: 9000, maxCars: 6, color: '#23303d', trim: '#c7c7c7' },
];

// Ships. A ship's hold is described as wagon-equivalents, so any cargo that fits that wagon type fits the hold.
// speed in mph, cost/upkeep in 1850 dollars (inflate). fullLoad: waits at its first stop until the hold is mostly full.
export const SHIPS = {
  packet:    { name: 'Packet Steamer',   year: 1850, speed: 18, cost: 85000,  upkeep: 8000,  model: 'packet',    holds: { coach: 3, van: 1, box: 4 },           len: 44 },
  barge:     { name: 'Bulk Barge Tow',   year: 1850, speed: 15,  cost: 95000,  upkeep: 9000,  model: 'barge',     holds: { hopper: 10, flat: 2 },               len: 70, fullLoad: true },
  tankbarge: { name: 'Tank Barge Tow',   year: 1865, speed: 15,  cost: 100000, upkeep: 9000,  model: 'tankbarge', holds: { tank: 10 },                           len: 70, fullLoad: true },
  freighter: { name: 'Steam Freighter',  year: 1880, speed: 20, cost: 160000, upkeep: 12000, model: 'freighter', holds: { box: 10, flat: 6, hopper: 8, reefer: 2 }, len: 62, fullLoad: true },
};

// Road vehicles. speed in mph; holds are road bodies. Roads are public: any company's vehicles may use any road,
// stopping at their own stations that have a road, or at road depots.
export const ROAD_VEHICLES = {
  // (speeds and loads are scaled for play, like the rest of the game: a horse team is slow but worth running on short feeders)
  stagecoach: { name: 'Stagecoach',          year: 1850, speed: 12, cost: 5000,  upkeep: 1500, model: 'coach',  holds: { stage: 1 } },
  wagon:      { name: 'Horse Freight Wagon', year: 1850, speed: 10, cost: 6000,  upkeep: 2000, model: 'wagon',  holds: { cart: 2 } },
  lorry:      { name: 'Steam Lorry',         year: 1885, speed: 16, cost: 12000, upkeep: 3000, model: 'lorry',  holds: { lorry: 2 } },
  truck:      { name: 'Motor Truck',         year: 1910, speed: 30, cost: 16000, upkeep: 3500, model: 'truck',  holds: { lorry: 3 } },
  bus:        { name: 'Motor Bus',           year: 1915, speed: 32, cost: 14000, upkeep: 3500, model: 'bus',    holds: { bus: 1 } },
  tanker:     { name: 'Tank Truck',          year: 1920, speed: 28, cost: 16000, upkeep: 3800, model: 'tanker', holds: { tanklorry: 3 } },
};

// Aircraft. speed in mph; holds are aircraft compartments. Planes fly between stations with an airfield.
export const PLANES = {
  biplane:   { name: 'Mailwing Biplane',   year: 1920, speed: 110, cost: 55000,  upkeep: 9000,  model: 'biplane',  holds: { mailbay: 1, cabin: 1 } },
  trimotor:  { name: 'Tri-motor Airliner', year: 1928, speed: 130, cost: 110000, upkeep: 16000, model: 'trimotor', holds: { cabin: 2, mailbay: 1 } },
  skyliner:  { name: 'Skyliner Twin',      year: 1936, speed: 170, cost: 190000, upkeep: 22000, model: 'twin',     holds: { cabin: 3, mailbay: 1, cargobay: 1 } },
  airfreight:{ name: 'Air Freighter',      year: 1946, speed: 190, cost: 240000, upkeep: 28000, model: 'freighter', holds: { cargobay: 4, mailbay: 1 } },
};

// town names for other maps (see World): drawn at random, 9 per map
export const TOWN_POOL = ['Ashford', 'Brennick', 'Coldwater', 'Dunmore', 'Elmsgate', 'Fairhaven', 'Greyhollow', 'Harrowby', 'Ivelton',
  'Juniper Falls', 'Kestrel', 'Larkspur', 'Millbrook', 'Northcote', 'Oakridge', 'Pinecrest', 'Quarry Hill', 'Redford', 'Stonebridge',
  'Thornbury', 'Upton', 'Valemont', 'Westmere', 'Yarrow', 'Amberly', 'Blackwater', 'Copperton', 'Driftwood', 'Eastwick', 'Foxley',
  'Glenmoor', 'Hollis', 'Ironvale', 'Kingsbridge', 'Lockhart', 'Marlow', 'Newbury', 'Oldcastle', 'Prescott', 'Rosedale', 'Silverton', 'Tamworth', 'Wexley'];
// Transport modes held back for a later expansion ("DLC"): the code is complete and tested, but they are off in
// the base game. ?dlc=1 in the address (or the tests) switches them on.
export const FEATURES = { ships: false, planes: false, roads: false };
export const TOWN_NAMES = ['Ashford', 'Brennick', 'Coldwater', 'Dunmore', 'Elmsgate', 'Fairhaven', 'Greyhollow', 'Harrowby', 'Ivelton'];

export const LEVEL_MUL = [0, 1, 1.35, 1.7, 2.0]; // industry output by level

export const ECON = {
  startCash: 1000000,
  loanStep: 250000,
  maxLoan: 1500000,
  interest: 0.06,
  stationCost: 32000,
  // roads: cost per unit of length (bridges extra), yearly upkeep per unit, a road depot (a small stop), steepest grade
  road: { perUnit: 16, bridgePerUnit: 110, upkeepPerUnit: 1, depotCost: 9000, maxGrade: 0.10 },
  trackPerUnit: 70,
  bridgePerUnit: 380,
  trackUpkeepPerUnit: 5,   // per year (double track × 1.75)
  unitsPerMile: 40,
  trackageRate: 60,        // $ per train-mile (about a quarter of what a train earns per mile) on another company's track (trackage rights), × price level
  daySeconds: 3.0,         // real seconds per game day at 1x
  catchment: 140,
  platformLen: 64,
  // freight pay per unit-mile = wt × tonRate + value × valueRate
  tonRate: 3.5,
  valueRate: 0.025,
  inflation: 0.01,         // per year, applies to cargo values, vehicle prices and running costs
  // town passengers / mail generated per resident per month
  paxPerPop: 0.09,
  mailPerPop: 0.045,
  // lowest price a consumer pays when oversupplied (towns hit hard, factories just stockpile)
  priceFloor: { town: 0.45, industry: 0.7 },
  // station storage, in wagonloads per cargo type: base and per warehouse level
  storage: [5, 15, 30, 50],
  warehouseCost: [0, 45000, 90000, 160000],
  warehouseUpkeep: [0, 3000, 6000, 10000], // per year
  // owned industries
  industryPriceYears: 1.6,   // price ≈ this many years of output value at level 1
  industryMargin: 0.45,    // share of the value of output picked up by trains that the owner earns
  expandCost: 0.6,         // expansion costs this share of the purchase price per level
  // harbors (a station upgrade): needs navigable water within this many units of the station
  harborCost: 60000,
  harborReach: 140,
  harborUpkeep: 4000,      // per year
  // airfields (a station upgrade, from the year the first plane appears)
  airportCost: 150000,
  airportUpkeep: 12000,    // per year
  airportReach: 260,       // runway centre within this distance of the station
  runwayLen: 240,
};

// Inventions (phase D): each is auctioned when its year comes; the winner has it alone for
// `patentYears`, then everyone does. Unsold inventions are free for all at once.
// reserve: minimum bid in 1850 dollars (inflates). Effects are applied where noted in sim.js.
export const INVENTIONS = {
  truss:     { name: 'Truss bridges',            year: 1856, reserve: 40000, desc: 'Bridges cost 30% less to build' },
  telegraph: { name: 'Telegraph dispatching',    year: 1861, reserve: 50000, desc: 'Trains load and unload 15% faster' },
  airbrake:  { name: 'Air brakes',               year: 1869, reserve: 80000, desc: 'Trains run 10% faster' },
  compound:  { name: 'Compound steam engines',   year: 1874, reserve: 70000, desc: 'Locomotive upkeep 15% lower' },
  reefer:    { name: 'Mechanical refrigeration', year: 1879, reserve: 50000, desc: 'Perishable cargo loses value half as fast' },
  diesel:    { name: 'Diesel-electric traction', year: 1925, reserve: 150000, desc: 'Locomotive upkeep 20% lower' },
  jet:       { name: 'Jet engines',              year: 1952, reserve: 200000, desc: 'Aircraft fly 25% faster' },
};
export const AUCTION = {
  days: 100,          // bidding stays open this long (every rival gets at least one turn)
  step: 1000,         // the winner pays the second-highest bid plus this (sealed-bid, second price)
  patentYears: 10,    // exclusivity for the winner of an invention
  newReserve: 0.35,   // reserve for a newly founded industry, × its list price
  sellReserve: 0.7,   // reserve for an industry a company sells (also the floor it gets if nobody bids)
};

// vehicle lengths in m (rules, not just looks: train length decides reservations and platform clearance)
export const LOCO_LEN = 13, WAGON_LEN = 8.4;

// ======== the continental rule set (CONTINENT_PLAN.md §2): regional raw goods, a clear tier ladder, and customers ========
// Every chain ends at a customer: towns, the army (forts and an army base), the export wharf, or the mint.
const CONT_CARGO = {
  passengers:  { name: 'Passengers',  unit: 'pax',     wt: 0.08,  cap: { coach: 40, cabin: 12 },             value: 65,  store: 'pax',   tier: 0, color: '#e8d7a9', speedy: true },
  mail:        { name: 'Mail',        unit: 'bags',    wt: 0.03,  cap: { van: 150, coach: 20, mailbay: 120 }, value: 15,  store: 'pax',   tier: 0, color: '#c9473d', speedy: true },
  // raw
  coal:        { name: 'Coal',        unit: 't',       wt: 1,     cap: { hopper: 30 },             value: 50,  store: 'bulk',   tier: 0, color: '#2b2b2b' },
  iron_ore:    { name: 'Iron Ore',    unit: 't',       wt: 1,     cap: { hopper: 32 },             value: 55,  store: 'bulk',   tier: 0, color: '#8f4a37' },
  copper_ore:  { name: 'Copper Ore',  unit: 't',       wt: 1,     cap: { hopper: 30 },             value: 80,  store: 'bulk',   tier: 0, color: '#4f8f7a' },
  logs:        { name: 'Logs',        unit: 't',       wt: 1,     cap: { flat: 22 },               value: 45,  store: 'bulk',   tier: 0, color: '#7a5532' },
  stone:       { name: 'Stone',       unit: 't',       wt: 1,     cap: { hopper: 30, flat: 22 },   value: 30,  store: 'bulk',   tier: 0, color: '#9a9a94' },
  grain:       { name: 'Grain',       unit: 't',       wt: 1,     cap: { hopper: 26, box: 18 },    value: 60,  store: 'bulk',   tier: 0, color: '#e3c15a' },
  livestock:   { name: 'Livestock',   unit: 'head',    wt: 0.5,   cap: { stock: 24 },              value: 90,  store: 'pen',    tier: 0, color: '#a2643a' },
  cotton:      { name: 'Cotton',      unit: 'bales',   wt: 0.25,  cap: { box: 60 },                value: 40,  store: 'goods',  tier: 0, color: '#f3f1ea' },
  niter:       { name: 'Niter',       unit: 't',       wt: 1,     cap: { hopper: 28, box: 16 },    value: 60,  store: 'bulk',   tier: 0, color: '#e8e4d8' },
  gold_ore:    { name: 'Gold & Silver Ore', unit: 't', wt: 1,     cap: { hopper: 24 },             value: 200, store: 'bulk',   tier: 0, color: '#d8b44a' },
  crude:       { name: 'Crude Oil',   unit: 't',       wt: 1,     cap: { tank: 28, box: 12 },      value: 120, store: 'liquid', tier: 0, color: '#1c1a17', year: 1860 },
  // tier 1
  steel:       { name: 'Steel',       unit: 't',       wt: 1,     cap: { flat: 25 },               store: 'bulk',   tier: 1, color: '#8d98a3' },
  lumber:      { name: 'Lumber',      unit: 't',       wt: 1,     cap: { flat: 22, box: 18 },      store: 'bulk',   tier: 1, color: '#c9a067' },
  copper:      { name: 'Copper',      unit: 't',       wt: 1,     cap: { flat: 25 },               store: 'bulk',   tier: 1, color: '#c87533' },
  flour:       { name: 'Flour',       unit: 't',       wt: 1,     cap: { box: 18, hopper: 22 },    store: 'goods',  tier: 1, color: '#f0e6d2' },
  meat:        { name: 'Meat',        unit: 't',       wt: 1,     cap: { reefer: 16, box: 10 },    store: 'cold',   tier: 1, color: '#c2414b', perish: true },
  textiles:    { name: 'Textiles',    unit: 't',       wt: 1,     cap: { box: 14 },                store: 'goods',  tier: 1, color: '#8e5ab8' },
  gunpowder:   { name: 'Gunpowder',   unit: 'kegs',    wt: 0.05,  cap: { box: 240 },               store: 'goods',  tier: 1, color: '#4a4a4a' },
  building:    { name: 'Building Materials', unit: 't', wt: 1,    cap: { flat: 24, hopper: 26 },   store: 'bulk',   tier: 1, color: '#bdb39a' },
  bullion:     { name: 'Bullion',     unit: 'bars',    wt: 0.012, cap: { box: 400 },               store: 'goods',  tier: 1, color: '#f1cf4b' },
  fuel:        { name: 'Fuel',        unit: 't',       wt: 1,     cap: { tank: 28, box: 12 },      store: 'liquid', tier: 1, color: '#d7a12a', year: 1860 },
  // tier 2
  weapons:     { name: 'Weapons',     unit: 'crates',  wt: 0.3,   cap: { box: 60 },                store: 'goods',  tier: 2, color: '#55603f' },
  ammunition:  { name: 'Ammunition',  unit: 'crates',  wt: 0.4,   cap: { box: 50 },                store: 'goods',  tier: 2, color: '#8a5a2b', year: 1860 },
  machinery:   { name: 'Machinery',   unit: 'units',   wt: 4,     cap: { flat: 5 },                store: 'goods',  tier: 2, color: '#3f6fb3' },
  food:        { name: 'Food',        unit: 't',       wt: 1,     cap: { reefer: 16, box: 12, cargobay: 3 }, store: 'cold', tier: 2, color: '#e9853b', perish: true },
  clothing:    { name: 'Clothing',    unit: 'crates',  wt: 0.1,   cap: { box: 120, cargobay: 50 }, store: 'goods',  tier: 2, color: '#d564a6' },
  goods:       { name: 'Goods',       unit: 'crates',  wt: 0.15,  cap: { box: 90 },                store: 'goods',  tier: 2, color: '#5d6d7e' },
};
const CONT_TOWN_ACCEPTS = ['passengers', 'mail', 'food', 'clothing', 'goods', 'building', 'fuel'];
const CONT_TOWN_GROWTH = { food: 3, building: 4, clothing: 2, goods: 3, fuel: 2, passengers: 0.5, mail: 0.5 };
const CONT_TOWN_DEMAND = { food: 6, clothing: 30, building: 8, goods: 25, fuel: 5, passengers: 1e9, mail: 1e9 };
// customers (`consumer`): `in` = what they buy per month at level 1; `premium` multiplies the price they pay
// regions: where an industry is found on the continent (a classic map ignores it); ccount: how many on the continent
const CONT_INDUSTRY = {
  // ---------- raw ----------
  coal_mine:    { name: 'Coal Mine',         regions: ['northeast', 'lakes', 'midwest'], kind: 'mine',   tier: 0, out: { coal: 160 },      boost: { machinery: 0.5 }, count: 3, terrain: 'hill' },
  iron_mine:    { name: 'Iron Mine',         regions: ['lakes', 'northeast'], kind: 'mine',   tier: 0, out: { iron_ore: 150 },  boost: { machinery: 0.5 }, count: 2, terrain: 'hill' },
  copper_mine:  { name: 'Copper Mine',       regions: ['mountains', 'southwest', 'lakes'], kind: 'mine',   tier: 0, out: { copper_ore: 120 }, boost: { machinery: 0.5 }, count: 1, terrain: 'hill' },
  gold_mine:    { name: 'Gold & Silver Mine', regions: ['mountains', 'pacific'], kind: 'mine',  tier: 0, out: { gold_ore: 40 },   boost: { machinery: 0.5 }, count: 1, terrain: 'hill' },
  quarry:       { name: 'Stone Quarry',      regions: ['northeast', 'midwest', 'south'], kind: 'pit',    tier: 0, out: { stone: 150 },     boost: { machinery: 0.4 }, count: 2, terrain: 'hill' },
  niter_beds:   { name: 'Niter Beds',        regions: ['south', 'midwest'], kind: 'pit',    tier: 0, out: { niter: 110 },     boost: { machinery: 0.3 }, count: 1, terrain: 'low' },
  lumber_camp:  { name: 'Lumber Camp',       regions: ['northeast', 'lakes', 'pacific', 'south'], kind: 'lumber', tier: 0, out: { logs: 130 },      boost: { machinery: 0.4 }, count: 3, terrain: 'forest' },
  grain_farm:   { name: 'Grain Farm',        regions: ['midwest', 'plains', 'pacific'], kind: 'farm',   tier: 0, out: { grain: 140 },     boost: { machinery: 0.4 }, count: 3, terrain: 'flat' },
  ranch:        { name: 'Cattle Ranch',      regions: ['plains', 'southwest', 'south'], kind: 'ranch',  tier: 0, out: { livestock: 90 },  boost: { machinery: 0.3 }, count: 2, terrain: 'flat' },
  cotton_farm:  { name: 'Cotton Plantation', regions: ['south'], kind: 'farm',   tier: 0, out: { cotton: 300 },    boost: { machinery: 0.3 }, count: 2, terrain: 'flat', field: '#efeee6' },
  oil_well:     { name: 'Oil Wells',         regions: ['northeast', 'south', 'southwest'], kind: 'well',   tier: 0, out: { crude: 120 },     boost: { machinery: 0.5 }, count: 2, terrain: 'any', year: 1860 },
  // ---------- tier 1 ----------
  sawmill:        { name: 'Sawmill',          kind: 'factory', tier: 1, in: { logs: 1.3 },                 out: { lumber: 1 },    cap: 120, count: 2, style: { hall: '#8a6a45', roof: '#5a4632', stacks: 1 } },
  steel_mill:     { name: 'Steel Mill',       kind: 'factory', tier: 1, in: { iron_ore: 1.5, coal: 0.9 },  out: { steel: 1 },     cap: 100, count: 2, style: { hall: '#6b5d55', roof: '#3c3836', stacks: 4, big: true } },
  copper_smelter: { name: 'Copper Smelter',   kind: 'factory', tier: 1, in: { copper_ore: 3, coal: 0.6 },  out: { copper: 1 },    cap: 40,  count: 1, style: { hall: '#7a6250', roof: '#4b6b5f', stacks: 2 } },
  stamp_mill:     { name: 'Stamp Mill',       kind: 'factory', tier: 1, in: { gold_ore: 1, coal: 0.2 },    out: { bullion: 6 },   cap: 45,  count: 1, style: { hall: '#8c7a5c', roof: '#5c4a32', stacks: 1 } },
  flour_mill:     { name: 'Flour Mill',       kind: 'factory', tier: 1, in: { grain: 1.3 },                out: { flour: 1 },     cap: 100, count: 1, style: { hall: '#d8cbb0', roof: '#7a5a3a', stacks: 0, silos: 4 } },
  packing_house:  { name: 'Packing House',    kind: 'factory', tier: 1, in: { livestock: 3 },              out: { meat: 1 },      cap: 30,  count: 1, style: { hall: '#c8b9a6', roof: '#6d3b32', stacks: 1 } },
  textile_mill:   { name: 'Textile Mill',     kind: 'factory', tier: 1, in: { cotton: 5 },                 out: { textiles: 1 },  cap: 60,  count: 1, style: { hall: '#a4553f', roof: '#3f3a3a', stacks: 1, saw: true } },
  powder_mill:    { name: 'Powder Mill',      kind: 'factory', tier: 1, in: { niter: 0.8, coal: 0.2 },     out: { gunpowder: 4 }, cap: 140, count: 1, style: { hall: '#7d7466', roof: '#3d3a33', stacks: 2 } },
  kilns:          { name: 'Lime & Brick Kilns', kind: 'factory', tier: 1, in: { stone: 1.2, coal: 0.3 },   out: { building: 1 },  cap: 130, count: 1, style: { hall: '#9c4733', roof: '#4c3a33', stacks: 3 } },
  refinery:       { name: 'Oil Refinery',     kind: 'factory', tier: 1, in: { crude: 1.25 },               out: { fuel: 1 },      cap: 100, count: 1, year: 1860, style: { hall: '#9a9a96', roof: '#6c6c69', stacks: 2, tanks: 4 } },
  // ---------- tier 2 ----------
  arsenal:        { name: 'Arsenal',          kind: 'factory', tier: 2, in: { steel: 0.25, lumber: 0.15, gunpowder: 0.6 }, out: { weapons: 1 }, cap: 150, count: 1, style: { hall: '#6e6a52', roof: '#3a3d30', stacks: 2, big: true } },
  cartridge_works:{ name: 'Cartridge Works',  kind: 'factory', tier: 2, in: { copper: 0.08, gunpowder: 1.2 }, out: { ammunition: 1 }, cap: 150, count: 1, year: 1860, style: { hall: '#7f6a4e', roof: '#45392b', stacks: 1, saw: true } },
  machine_works:  { name: 'Machine Works',    kind: 'factory', tier: 2, in: { steel: 2.5, copper: 0.6 },   out: { machinery: 1 }, cap: 25,  count: 1, style: { hall: '#6f7f8c', roof: '#2f3d4c', stacks: 3, saw: true, big: true } },
  cannery:        { name: 'Cannery',          kind: 'factory', tier: 2, in: { flour: 0.6, meat: 0.5 },     out: { food: 1 },      cap: 60,  count: 1, style: { hall: '#e0d6c4', roof: '#a04a3a', stacks: 1, silos: 2 } },
  garment_works:  { name: 'Garment Works',    kind: 'factory', tier: 2, in: { textiles: 0.12 },            out: { clothing: 1 },  cap: 300, count: 1, style: { hall: '#c7a28f', roof: '#55406a', stacks: 1 } },
  goods_factory:  { name: 'Goods Factory',    kind: 'factory', tier: 2, in: { steel: 0.08, lumber: 0.1, textiles: 0.04 }, out: { goods: 1 }, cap: 250, count: 1, style: { hall: '#b48a5e', roof: '#4a3b2c', stacks: 1, saw: true } },
  // ---------- customers ----------
  army_base:      { name: 'Army Base',        kind: 'base',    tier: 3, consumer: true, army: true, ccount: 3, premium: 1.35, in: { weapons: 40, ammunition: 40, food: 30, clothing: 150, livestock: 20 }, cap: 1, out: {}, count: 1, color: '#6b6a4a' },
  fort:           { name: 'Frontier Fort',    kind: 'fort',    tier: 3, consumer: true, army: true, ccount: 6, regions: ['plains', 'mountains', 'southwest'], premium: 1.4,  in: { weapons: 15, ammunition: 15, food: 12, clothing: 50, livestock: 10 },  cap: 1, out: {}, count: 2, terrain: 'remote', color: '#8a6a3a' },
  export_wharf:   { name: 'Export Wharf',     kind: 'wharf',   tier: 3, consumer: true, ccount: 4, premium: 0.85, in: { cotton: 200, grain: 150, flour: 100, lumber: 100 }, cap: 1, out: {}, count: 1, terrain: 'river', color: '#4a6a8a' },
  mint:           { name: 'Mint',             kind: 'mint',    tier: 3, consumer: true, ccount: 2, premium: 1.2,  in: { bullion: 300 }, cap: 1, out: {}, count: 1, terrain: 'town', color: '#c9a64a' },
};

// Wartime periods (CONTINENT_PLAN.md §3; economic only, no fighting in the game): the army's customers buy `mul` times as
// much and pay more, announced a year ahead; for two years after, they buy less (×0.6). Invented names.
const CONT_WARS = [
  { from: 1861, to: 1865, mul: 3, name: 'the War of the Union' },
  { from: 1898, to: 1898, mul: 1.8, name: 'the Island War' },
  { from: 1917, to: 1918, mul: 3, name: 'the Great War overseas' },
];
const SETS = {
  classic: { cargo: CLASSIC_CARGO, accepts: CLASSIC_TOWN_ACCEPTS, growth: CLASSIC_TOWN_GROWTH, demand: CLASSIC_TOWN_DEMAND, industry: CLASSIC_INDUSTRY },
  continental: { cargo: CONT_CARGO, accepts: CONT_TOWN_ACCEPTS, growth: CONT_TOWN_GROWTH, demand: CONT_TOWN_DEMAND, industry: CONT_INDUSTRY, wars: CONT_WARS },
};
// Put a rule set in play (before a map is made). New games use 'continental'; saves from before it existed use 'classic'.
export function useRules(name = 'continental') {
  const set = SETS[name] || SETS.continental;
  RULES.name = SETS[name] ? name : 'continental';
  const fill = (target, src) => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, structuredClone(src)); };
  RULES.wars = set.wars || [];
  fill(CARGO, set.cargo); fill(INDUSTRY, set.industry); fill(TOWN_GROWTH, set.growth); fill(TOWN_DEMAND, set.demand);
  TOWN_ACCEPTS.length = 0; TOWN_ACCEPTS.push(...set.accepts);
  // road capacities: a horse cart carries about 30% of a rail wagon, a lorry body about 60% (liquids in tank bodies)
  for (const c of Object.values(CARGO)) {
    const dry = Math.max(0, ...['box', 'hopper', 'flat', 'stock', 'reefer'].map(t => c.cap[t] || 0));
    if (dry) { c.cap.cart = Math.max(1, Math.round(dry * 0.3)); c.cap.lorry = Math.max(1, Math.round(dry * 0.6)); }
    if (c.cap.tank) c.cap.tanklorry = Math.max(1, Math.round(c.cap.tank * 0.6));
  }
  Object.assign(CARGO.passengers.cap, { stage: 14, bus: 36 });
  Object.assign(CARGO.mail.cap, { stage: 20, bus: 50 });
  deriveValues();
  return RULES.name;
}
useRules('continental');
