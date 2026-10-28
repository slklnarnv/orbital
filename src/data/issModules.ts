// ─── ISS module catalogue (module explorer, plan 017 X1) ─────────────────────
//
// One entry per element the explorer can pick. `parts` lists the asset keys
// the entry covers: the batch-name prefix of a static module
// (`<module>.batch.<material>` under SSREF_IGOAL) or the rigid-part root a
// driven joint batches under (scripts/build-iss-model.mjs batchRigidMeshes).
// tests/unit/rendering/ModuleExplorer.test.ts checks that every key in both
// IGOAL assets resolves to exactly one entry.
//
// Facts: launch dates, agencies and masses are from NASA's "Station Assembly
// Elements" page and the element pages it links
// (https://www.nasa.gov/international-space-station/international-space-station-assembly-elements/),
// read 2026-10-26. NASA gives masses in pounds; they are kept as published
// (`massLb`) and converted for display. Where NASA publishes no mass the
// card shows "—". The purpose lines are our own summaries, not quotations.

export type ModuleAgency =
  | 'NASA'
  | 'Roscosmos'
  | 'ESA'
  | 'JAXA'
  | 'CSA'
  | 'Bigelow Aerospace'
  | 'Nanoracks'

export interface IssModule {
  /** Stable id (kebab case). */
  id: string
  /** Display name, sentence case. */
  name: string
  /** Partner responsible for the element on orbit. */
  agency: ModuleAgency
  /** Builder, when it differs from the agency. */
  builtBy?: string
  /** Launch year of the element (the first part, for a group). */
  launchYear: number
  /** Context for a grouped or later-upgraded element. */
  launchNote?: string
  /** Mass as NASA publishes it, in pounds; null when NASA gives none. */
  massLb: number | null
  /** Qualifies the mass (e.g. which part of a group it covers). */
  massNote?: string
  /** One or two sentences, our own wording. */
  purpose: string
  /** Asset part keys this entry covers. */
  parts: string[]
}

export const ISS_MODULES: readonly IssModule[] = [
  {
    id: 'zarya', name: 'Zarya', agency: 'Roscosmos', builtBy: 'Khrunichev, funded by NASA',
    launchYear: 1998, massLb: 42600, parts: ['Zarya_FGB'],
    purpose: 'The first module launched. It gave the early station power, propulsion and attitude control; today it is mostly storage and fuel tankage.',
  },
  {
    id: 'unity', name: 'Unity (Node 1)', agency: 'NASA', launchYear: 1998, massLb: 26225, parts: ['Node1'],
    purpose: 'The first US node, joining the US and Russian segments. Destiny, Quest, Tranquility and the S0 truss attach to it.',
  },
  {
    id: 'pma1', name: 'Pressurized mating adapter 1', agency: 'NASA', launchYear: 1998,
    launchNote: 'Launched with Unity', massLb: null, parts: ['PMA1'],
    purpose: 'A tapered pressurized adapter that links Unity to Zarya.',
  },
  {
    id: 'pma2', name: 'Pressurized mating adapter 2', agency: 'NASA', launchYear: 1998,
    launchNote: 'Launched with Unity', massLb: null, parts: ['PMA2'],
    purpose: 'Carries an international docking adapter on Harmony’s forward port for crew and cargo vehicles.',
  },
  {
    id: 'pma3', name: 'Pressurized mating adapter 3', agency: 'NASA', launchYear: 2000,
    launchNote: 'Launched with the Z1 truss', massLb: null, parts: ['PMA3'],
    purpose: 'Carries an international docking adapter on Harmony’s space-facing port.',
  },
  {
    id: 'zvezda', name: 'Zvezda service module', agency: 'Roscosmos', launchYear: 2000, massLb: 54242, parts: ['Zvezda_SM'],
    purpose: 'The core of the Russian segment: crew quarters, life support, flight control and propulsion, with docking ports for Soyuz and Progress.',
  },
  {
    id: 'z1', name: 'Z1 truss', agency: 'NASA', launchYear: 2000, massLb: null, parts: ['Z1'],
    purpose: 'A short zenith truss on Unity carrying the control moment gyroscopes and communications antennas.',
  },
  {
    id: 'destiny', name: 'Destiny laboratory', agency: 'NASA', launchYear: 2001, massLb: 32000, parts: ['USLab'],
    purpose: 'The primary US research laboratory, with racks for science and for station systems.',
  },
  {
    id: 'esp1', name: 'External stowage platform 1', agency: 'NASA', launchYear: 2001, massLb: null, parts: ['ESP1'],
    purpose: 'An unpressurized pallet that holds spare parts outside the station.',
  },
  {
    id: 'mss', name: 'Canadarm2 and mobile base', agency: 'CSA', launchYear: 2001,
    launchNote: 'Canadarm2 2001, mobile base 2002, Dextre 2008', massLb: 3300, massNote: 'Canadarm2 alone',
    parts: ['MT_Location'],
    purpose: 'The mobile servicing system: the 17.6 m robotic arm, the base that carries it along the truss, and the Dextre hand.',
  },
  {
    id: 'quest', name: 'Quest airlock', agency: 'NASA', launchYear: 2001, massLb: 21877, parts: ['Airlock'],
    purpose: 'The US airlock: an equipment lock for spacesuit servicing and a crew lock for spacewalks.',
  },
  {
    id: 's0', name: 'S0 truss', agency: 'NASA', launchYear: 2002, massLb: null, parts: ['Truss_S0'],
    purpose: 'The centre segment of the integrated truss, mounted on Destiny; it routes power, data and cooling to the modules.',
  },
  {
    id: 's1', name: 'S1 truss', agency: 'NASA', launchYear: 2002, massLb: null, parts: ['Truss_S1'],
    purpose: 'The first starboard truss segment, carrying cooling hardware and the mobile transporter rails.',
  },
  {
    id: 's1-radiator', name: 'S1 heat rejection radiator', agency: 'NASA', launchYear: 2002,
    launchNote: 'Launched on the S1 truss', massLb: null, parts: ['STBD_TRRJ_GAMMA_ROT'],
    purpose: 'Ammonia-cooled radiator panels that shed the station’s heat; a rotary joint can turn them edge-on to the Sun.',
  },
  {
    id: 'p1', name: 'P1 truss', agency: 'NASA', launchYear: 2002, massLb: null, parts: ['Truss_P1'],
    purpose: 'The first port truss segment, mirroring S1.',
  },
  {
    id: 'p1-radiator', name: 'P1 heat rejection radiator', agency: 'NASA', launchYear: 2002,
    launchNote: 'Launched on the P1 truss', massLb: null, parts: ['PORT_TRRJ_GAMMA_ROT'],
    purpose: 'The port twin of the S1 radiator, rejecting heat from the external cooling loop.',
  },
  {
    id: 'esp2', name: 'External stowage platform 2', agency: 'NASA', launchYear: 2005, massLb: null, parts: ['ESP2'],
    purpose: 'An unpressurized pallet on Quest that holds spare parts.',
  },
  {
    id: 'p3', name: 'P3 truss', agency: 'NASA', launchYear: 2006, launchNote: 'Launched with P4', massLb: null, parts: ['Truss_P3'],
    purpose: 'The inboard half of the port solar alpha rotary joint, which turns the outboard truss to follow the Sun.',
  },
  {
    id: 'port-outboard', name: 'Port outboard truss (P4–P6)', agency: 'NASA', launchYear: 2006,
    launchNote: 'P4 and P5 in 2006; P6 flew in 2000 and moved here in 2007', massLb: null, parts: ['PORT_ALPHA_ROT'],
    purpose: 'The truss beyond the port rotary joint, carrying the power hardware for four solar array wings.',
  },
  {
    id: 'p4-arrays', name: 'Solar array wings 2A and 4A', agency: 'NASA', launchYear: 2006,
    launchNote: 'Roll-out array added to 4A in 2022', massLb: null, parts: ['PORT_BETA_ROT_2A', 'PORT_BETA_ROT_4A'],
    purpose: 'Two 35 m photovoltaic wings on P4, each tilted by its own beta gimbal.',
  },
  {
    id: 'p6-arrays', name: 'Solar array wings 2B and 4B', agency: 'NASA', launchYear: 2000,
    launchNote: 'Roll-out arrays added in 2021', massLb: null, parts: ['PORT_BETA_ROT_2B', 'PORT_BETA_ROT_4B'],
    purpose: 'The station’s oldest main arrays, on P6, now overlaid by roll-out solar arrays.',
  },
  {
    id: 's3', name: 'S3 truss', agency: 'NASA', launchYear: 2007, launchNote: 'Launched with S4', massLb: null, parts: ['Truss_S3'],
    purpose: 'The inboard half of the starboard solar alpha rotary joint; it also hosts external payload sites.',
  },
  {
    id: 'stbd-outboard', name: 'Starboard outboard truss (S4–S6)', agency: 'NASA', launchYear: 2007,
    launchNote: 'S4 and S5 in 2007, S6 in 2009', massLb: null, parts: ['STBD_ALPHA_ROT'],
    purpose: 'The truss beyond the starboard rotary joint, carrying the power hardware for four solar array wings.',
  },
  {
    id: 's4-arrays', name: 'Solar array wings 1A and 3A', agency: 'NASA', launchYear: 2007,
    launchNote: 'Roll-out arrays added in 2022 (3A) and 2023 (1A)', massLb: null,
    parts: ['STBD_BETA_ROT_1A', 'STBD_BETA_ROT_3A'],
    purpose: 'Two 35 m photovoltaic wings on S4, each tilted by its own beta gimbal.',
  },
  {
    id: 's6-arrays', name: 'Solar array wings 1B and 3B', agency: 'NASA', launchYear: 2009,
    launchNote: 'Roll-out array added to 1B in 2023', massLb: null,
    parts: ['STBD_BETA_ROT_1B', 'STBD_BETA_ROT_3B'],
    purpose: 'The last main arrays delivered, on S6; their installation completed the integrated truss.',
  },
  {
    id: 'esp3', name: 'External stowage platform 3', agency: 'NASA', launchYear: 2007, massLb: null, parts: ['ESP3'],
    purpose: 'An unpressurized pallet on the P3 truss that holds spare parts.',
  },
  {
    id: 'harmony', name: 'Harmony (Node 2)', agency: 'NASA', builtBy: 'Thales Alenia Space for ESA',
    launchYear: 2007, massLb: 32599, parts: ['Node2'],
    purpose: 'The hub joining Destiny, Columbus and Kibo, with docking ports for commercial crew and cargo vehicles.',
  },
  {
    id: 'columbus', name: 'Columbus laboratory', agency: 'ESA', launchYear: 2008, massLb: 22700, parts: ['Columbus'],
    purpose: 'Europe’s research laboratory, with ten payload racks inside and external platforms for exposed experiments.',
  },
  {
    id: 'kibo-elm', name: 'Kibo logistics module', agency: 'JAXA', launchYear: 2008, massLb: 4200, parts: ['JEM_PS'],
    purpose: 'A storage section on top of the Kibo laboratory for experiments, tools and supplies.',
  },
  {
    id: 'kibo-pm', name: 'Kibo laboratory', agency: 'JAXA', launchYear: 2008, massLb: 35050, parts: ['JEM_PM'],
    purpose: 'Japan’s pressurized laboratory, the largest single module, with its own airlock and robotic arm.',
  },
  {
    id: 'kibo-ef', name: 'Kibo exposed facility', agency: 'JAXA', launchYear: 2009, massLb: 9038, parts: ['JEM_EF'],
    purpose: 'An external porch where experiments sit in open space for Earth observation and materials research.',
  },
  {
    id: 'poisk', name: 'Poisk (MRM2)', agency: 'Roscosmos', launchYear: 2009, massLb: 8367, parts: ['MRM2'],
    purpose: 'A small module on Zvezda’s zenith port: a docking port for Soyuz and Progress and an airlock for Russian spacewalks.',
  },
  {
    id: 'elc1', name: 'ExPRESS logistics carrier 1', agency: 'NASA', launchYear: 2009, massLb: null, parts: ['ELC_1'],
    purpose: 'An external platform on the truss for payloads and spare parts.',
  },
  {
    id: 'elc2', name: 'ExPRESS logistics carrier 2', agency: 'NASA', launchYear: 2009, massLb: null, parts: ['ELC_2'],
    purpose: 'An external platform on the truss for payloads and spare parts.',
  },
  {
    id: 'tranquility', name: 'Tranquility (Node 3)', agency: 'NASA', builtBy: 'Thales Alenia Space for ESA',
    launchYear: 2010, massLb: 39665, parts: ['Node3'],
    purpose: 'Life support, a toilet and exercise equipment, and the ports for the Cupola, BEAM, Bishop and Leonardo.',
  },
  {
    id: 'cupola', name: 'Cupola', agency: 'NASA', builtBy: 'ESA', launchYear: 2010, massLb: 4136, parts: ['Cupola'],
    purpose: 'Seven windows facing Earth; the crew watches robotics, arrivals and the planet from here.',
  },
  {
    id: 'rassvet', name: 'Rassvet (MRM1)', agency: 'Roscosmos', launchYear: 2010, massLb: 11188, parts: ['MRM1'],
    purpose: 'Cargo storage and a docking port on Zarya’s Earth-facing side.',
  },
  {
    id: 'pmm', name: 'Leonardo (PMM)', agency: 'NASA', builtBy: 'Thales Alenia Space for ASI',
    launchYear: 2011, launchNote: 'Flew as a cargo carrier from 2001; stayed permanently in 2011', massLb: 9784,
    parts: ['PMM'],
    purpose: 'A permanent storage module on Tranquility, converted from a shuttle cargo carrier.',
  },
  {
    id: 'elc4', name: 'ExPRESS logistics carrier 4', agency: 'NASA', launchYear: 2011, massLb: null, parts: ['ELC_4'],
    purpose: 'An external platform on the truss for payloads and spare parts.',
  },
  {
    id: 'elc3', name: 'ExPRESS logistics carrier 3', agency: 'NASA', launchYear: 2011, massLb: null, parts: ['ELC_3'],
    purpose: 'An external platform on the truss for payloads and spare parts.',
  },
  {
    id: 'ams', name: 'Alpha Magnetic Spectrometer', agency: 'NASA', builtBy: 'An international collaboration led by the US Department of Energy',
    launchYear: 2011, massLb: 18739, parts: ['AMS'],
    purpose: 'A particle detector on the S3 truss that has recorded billions of cosmic-ray events, searching for antimatter and dark matter.',
  },
  {
    id: 'beam', name: 'BEAM', agency: 'Bigelow Aerospace', launchYear: 2016, massLb: 3115.1, parts: ['BEAM'],
    purpose: 'An expandable fabric habitat on Tranquility, launched folded and inflated in orbit; now used for storage.',
  },
  {
    id: 'bishop', name: 'Bishop airlock', agency: 'Nanoracks', launchYear: 2020, massLb: null, parts: ['Bishop_Airlock'],
    purpose: 'A commercial airlock that moves payloads and small satellites between the cabin and space.',
  },
  {
    id: 'nauka', name: 'Nauka (MLM)', agency: 'Roscosmos', launchYear: 2021, massLb: null, parts: ['MLM'],
    purpose: 'Russia’s multipurpose laboratory on Zvezda’s nadir port, with the European Robotic Arm mounted outside.',
  },
  {
    id: 'prichal', name: 'Prichal', agency: 'Roscosmos', launchYear: 2021, massLb: null, parts: ['Russian_RSNode_DockingModule'],
    purpose: 'A spherical node on Nauka with five docking ports for Russian vehicles; the most recent module.',
  },
]

const POUNDS_TO_KG = 0.45359237

/** "19,320 kg" (rounded to 10 kg), or "—" when the mass is unknown. */
export function formatModuleMass(massLb: number | null): string {
  if (massLb === null || !Number.isFinite(massLb)) return '—'
  const kg = Math.round((massLb * POUNDS_TO_KG) / 10) * 10
  return `${kg.toLocaleString('en-US')} kg`
}
