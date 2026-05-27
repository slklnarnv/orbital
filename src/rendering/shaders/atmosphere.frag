precision highp float;

uniform vec3 sunDirection;

varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  // ── World-Space Vectors ──────────────────────────────────────────────────────
  // vNormal is the outward surface normal of the atmosphere sphere (pointing away from Earth center).
  // vWorldPosition is the fragment position on the sphere surface.
  vec3 normal  = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // ── BackSide Sphere — Critical Normal Correction ──────────────────────────────
  //
  // GEOMETRY INVARIANT:
  //   This sphere is rendered with side=THREE.BackSide.
  //   The camera is OUTSIDE the sphere (geocentric camera r > ATMOSPHERE_RADIUS).
  //   Three.js BackSide reverses face culling, so the VISIBLE fragments are on the
  //   FAR hemisphere (the hemisphere opposite the camera).
  //
  // BUG IN NAIVE IMPLEMENTATION:
  //   For every visible far-hemisphere fragment, the outward normal points
  //   AWAY from the camera. Therefore:
  //     dot(normal, viewDir) ≤ 0 for all visible fragments
  //     max(dot(normal, viewDir), 0.0) = 0 for all visible fragments
  //     limb = 1 - 0 = 1.0 for ALL visible fragments
  //   Result: entire back disc glows at MAXIMUM intensity → giant cyan panel.
  //
  // CORRECT FORMULATION (with -normal):
  //   At limb edge (tangent to view ray): dot(-normal, viewDir) ≈ 0 → limb ≈ 1.0 → GLOW ✓
  //   At far-hemisphere center (behind Earth): dot(-normal, viewDir) ≈ 1.0 → limb ≈ 0.0 → DARK ✓
  //   This correctly localizes glow to the Earth's visible limb edge.
  //
  float dotNV = max(dot(-normal, viewDir), 0.0);

  // ── Angular Compression & Surface Integration ────────────────────────────────
  // Geometric Horizon Invariant:
  //   For Earth (6371 km) and Atmosphere (6530.3 km) rendered on the BackSide,
  //   tangents to the Earth's surface occur at exactly dotNV = 0.22016.
  //   - dotNV ∈ [0.0, 0.22016] represents the atmosphere outside the Earth's disk (space).
  //   - dotNV > 0.22016 represents the atmosphere inside/in front of the Earth's disk.
  
  float glow = 0.0;
  float colorBlend = 0.0;

  if (dotNV <= 0.22016) {
    // Outside the Earth's disk (atmosphere shell in space)
    // hFactor goes from 1.0 (Earth surface, dotNV=0.22016) to 0.0 (outer space, dotNV=0.0)
    float hFactor = dotNV / 0.22016;

    // Core thread: Concentrates strictly at lowest altitudes. Multiplier 7.8 gives brilliant overexposure.
    float limb_core = pow(hFactor, 42.0) * 7.8;

    // Blue body: Localized rich blue. Power 16 keeps it narrow and restrained.
    float limb_band = pow(hFactor, 16.0) * 0.15;

    // Outer haze: Imperceptible smoothing to prevent hard outer sphere edges.
    float limb_haze = pow(hFactor, 6.0) * 0.005;

    glow = limb_core + limb_band + limb_haze;

    // Strengthened forward scattering sun-facing rim response:
    // As the camera looks towards the sun, the limb overexposes into a thin, brilliant, white-hot thread.
    float viewSunDot = dot(viewDir, normalize(sunDirection));
    float forwardScatter = pow(max(viewSunDot, 0.0), 6.0); // Slightly tightened angular compression
    glow += forwardScatter * 5.2 * pow(hFactor, 16.0); // Strengthened rim scattering multiplier (was 3.8)

    // Color blend is also driven by altitude, concentrating white/cyan strictly to the surface thread
    colorBlend = pow(hFactor, 12.0);
  } else {
    // Inside the Earth's disk (frontal suppression to prevent blue fog)
    // Decays to absolute zero extremely fast within ~1.5° of arc (width 0.042) inside the horizon.
    float fadeFactor = clamp(1.0 - (dotNV - 0.22016) / 0.042, 0.0, 1.0);
    
    // Smooth transition from peak horizon intensity (7.8 + 0.15 + 0.005 = 7.955)
    glow = 7.955 * pow(fadeFactor, 3.0);

    // Maintain white thread right at the boundary, fading to blue as we go inward
    colorBlend = pow(fadeFactor, 4.0);
  }

  // ── Photographic Color Gradient ───────────────────────────────────────────────
  // Orbital photography shows the atmosphere as:
  //   - Near-white/cyan at the absolute limb edge (Rayleigh saturated by low path length)
  //   - Rich deep blue a few degrees inward (Rayleigh scattered light at moderate depth)
  //
  vec3 limbWhite = vec3(0.75, 0.91, 1.00); // Near-white cyan — the overexposed limb thread
  vec3 dayBlue   = vec3(0.08, 0.35, 0.90); // Deep restrained aerospace blue
  vec3 atmoColor = mix(dayBlue, limbWhite, colorBlend);

  // ── Terminator Twilight Localization ─────────────────────────────────────────
  // NOTE: sunDot uses the ORIGINAL outward normal (not -normal).
  // The sun-facing test must determine if the fragment's location on the sphere
  // is on the lit or unlit side of Earth — outward normal is correct for this.
  float sunDot = dot(normal, normalize(sunDirection));

  // Widen twilight transition zone to a ~6° physical band centered at the terminator (sunDot ≈ 0.0)
  // Range: sunDot ∈ [-0.06, 0.08]
  float twilightWeight = smoothstep(0.08, -0.04, sunDot) * smoothstep(-0.06, 0.04, sunDot);

  // Multi-tier Rayleigh sunset gradient:
  // Crimson at dense lowest altitudes (altFactor near 1.0), gold at higher, thinner altitudes.
  float altFactor = dotNV <= 0.22016 ? (dotNV / 0.22016) : clamp(1.0 - (dotNV - 0.22016) / 0.042, 0.0, 1.0);

  vec3 twilightCrimson = vec3(0.92, 0.20, 0.04); // Luminous warm reddish-orange (deep atmospheric penetration)
  vec3 twilightGold    = vec3(0.98, 0.62, 0.10); // Luminous warm gold (shorter scatter path)
  vec3 twilightColor   = mix(twilightCrimson, twilightGold, pow(altFactor, 1.5));

  // Additive solar twilight glow:
  // Blend twilight gradient into the base atmosphere color with enhanced weight for a breathtaking sunrise/sunset glow
  atmoColor = mix(atmoColor, twilightColor, twilightWeight * 0.68);

  // ── Progressive Nightside Extinction ─────────────────────────────────────────
  // The atmosphere disappears completely on the nightside.
  // Transition: full at sunDot ≥ 0.08, completely dark at sunDot ≤ -0.15.
  float extinction = smoothstep(-0.15, 0.08, sunDot);

  // ── Final Alpha & Camera Proximity Fade ───────────────────────────────────────
  // The glow energy is modulated by the nightside extinction.
  // Master scale 0.92 preserves ACES headroom for the HDR thread to bloom properly
  // without crushing the blue gradient behind it.
  //
  // Proximity Fade: As the camera approaches or enters the atmosphere sphere (r <= 6530.3 km),
  // we smoothly fade out the shell to prevent BackSide rendering double-arch occlusion glitches.
  // Widened band up to 6900.0 km delivers ultra-smooth, progressive blending during close zoom.
  float camDist = length(cameraPosition);
  float proximityFade = smoothstep(6530.275, 6900.0, camDist);

  float alpha = glow * extinction * 0.92 * proximityFade;

  gl_FragColor = vec4(atmoColor, alpha);
}
