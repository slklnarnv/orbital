# ORBITAL

A real-time ISS orbital visualization platform. ORBITAL combines live SGP4 telemetry, physically calibrated Earth rendering, and a simulation-first architecture into a browser-based mission visualization system.


---

ORBITAL renders the International Space Station in accurate real-time orbit using live Two-Line Element data propagated through SGP4. The ISS position is computed in the ECI inertial frame and rendered independently of the ECEF-rotating Earth — the station naturally tracks its real geographic ground path without manual correction. Custom GLSL shaders handle Earth surface day/night blending, atmospheric limb scattering, and orbit line alpha fade. Simulation and rendering are fully decoupled: the renderer reads state, never drives it.

---

## Architecture

Five strict layers. Data flows downward; no layer bypasses the one below it.

```
Layer 5 — UI / Presentation    HUD panels, telemetry overlays, navigation controls
Layer 4 — Interaction          Camera FSM, zoom level manager, raycasting
Layer 3 — Rendering            Scene graph, Earth/ISS/orbit renderers, GLSL shaders
Layer 2 — Telemetry            TLE ingestion, SGP4 propagation, coordinate transforms
Layer 1 — Simulation           SimulationClock, TLE cache, offline fallback
```

---

## Rendering Pipeline

### Earth

Layered geometry stack rendered back-to-front:

| Pass | Radius | Description |
|:---|:---|:---|
| Star field | Background | NASA starmap + procedural point stars |
| Surface | 1.000× | NASA Blue Marble day albedo blended with Black Marble city lights via GLSL terminator |
| Cloud layer | 1.003× | Grayscale alphaMap with slow wind-drift rotation |
| Atmosphere | 1.025× | Fresnel rim halo on `BackSide` with `AdditiveBlending`. Horizon-compressed density falloff. |

The surface shader blends day and night textures using a `smoothstep` terminator driven by the dot product of the world-space vertex normal and sun direction. Both vectors must be in world space — a camera/world space mismatch was the root cause of the initial dark-globe bug:

```glsl
// earthSurface.vert
vNormal = normalize(mat3(modelMatrix) * normal);

// earthSurface.frag
float sunDot    = dot(vNormal, sunDirection);
float dayMask   = smoothstep(-0.1, 0.2, sunDot);
float nightMask = 1.0 - smoothstep(-0.15, 0.05, sunDot);
vec3  color     = dayColor * dayMask + nightColor * nightMask + specular;
```

`EarthGroup` rotates on its Y-axis by the current GMST each frame, keeping surface geography correctly oriented relative to the sun.

### ISS

`ISSGroup` lives in the ECI frame — it does not inherit the Earth's GMST rotation. ISS position is applied via direct ref mutation inside `useFrame`, with no React state involved:

```typescript
useFrame(() => {
  const state = issEntity.propagate(simulationClock.now());
  const pos   = temeToThreeJS(state.positionECI);   // { x, y: z, z: -y }
  issGroupRef.current.position.set(pos.x, pos.y, pos.z);
});
```

The model uses a multi-level LOD system. At planetary scale, a lightweight placeholder is used (truss cylinder + solar array boxes at real-world scale: ~0.109 km wide). A distance-scaled adaptive fill light increases readability at close-range inspection without affecting global scene lighting.

### Orbit Prediction Line

Propagated forward one full orbital period (~92 min) via SGP4, regenerated every 60 seconds. Each vertex carries a custom `alpha` attribute — fading from 0 at the trailing edge to 1 at the leading arc — rendered through a dedicated GLSL line shader.

---

## Telemetry

The telemetry layer runs in three modes with automatic fallback:

| Mode | Condition |
|:---|:---|
| `LIVE` | Fresh TLE from CelesTrak |
| `HYBRID` | Cached TLE propagated forward; confidence degrades with TLE age |
| `OFFLINE` | Hardcoded fallback TLE; no network dependency |

TLE data is persisted in IndexedDB via `idb-keyval`. The application runs fully offline after first load.

---

## Camera System

Three modes implemented as a finite state machine:

| Mode | Behavior |
|:---|:---|
| `ORBITAL` | Free-orbit around Earth via damped `CameraControls` |
| `FOLLOW` | Locks to ISS with telemetry tracking across all zoom scales |
| `INSPECT` | Close-range ISS inspection; LOD switches to full-detail model |

---

## Stack

| Category | Technology |
|:---|:---|
| Framework | React 18, TypeScript (strict), Vite |
| 3D Engine | Three.js r160+, React Three Fiber, Drei |
| Shaders | Custom GLSL via `vite-plugin-glsl` |
| Orbital Propagation | `satellite.js` (SGP4/SDP4) |
| State | Zustand 4 with transient subscriptions |
| Styling | TailwindCSS v4 |
| Persistence | `idb-keyval` (IndexedDB TLE cache) |

---

## Project Structure

```
src/
├── core/
│   ├── clock/        SimulationClock — single authoritative time source
│   └── orbital/      OrbitalEngine (SGP4 wrapper), CoordinateConversions
├── rendering/
│   ├── scene/        SceneRoot, EnvironmentLayer
│   ├── earth/        EarthGroup, EarthSurface, AtmosphereShell, CloudLayer
│   ├── iss/          ISSGroup, ISSModel, OrbitLine
│   └── shaders/      GLSL vertex and fragment shaders
├── stores/           Zustand stores (simulation, telemetry)
├── hooks/            useSimulationClock, useOrbitalState
├── ui/               HudOverlay, telemetry panels
└── types/            OrbitalState, SimulationTime, coordinate types
```

---

## Getting Started

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/yourusername/orbital.git
cd orbital
npm install
npm run dev
```

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

---

## Roadmap

**Phase 3A — ISS Detail**
- NASA glTF model with separated module meshes
- Per-module raycasting, hover highlight, and selection
- Spatial annotation system (3D billboard labels)
- Full 4-level LOD pipeline with alpha crossfade transitions

**Phase 3B — Cinematic Polish**
- Precomputed atmospheric scattering (Bruneton model) for physically-based terminator coloring
- Solar array sun-tracking rotation
- Earth shadow interaction with ISS geometry

**Phase 3C — Educational Systems**
- Ground track display and passover prediction
- ISS module metadata registry
- Time controls: pause, accelerate, historical replay

---

## License

MIT — Developed by Arnav S.
