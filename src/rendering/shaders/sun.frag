precision highp float;
varying vec2 vUv;

void main() {
  vec2 p = vUv - vec2(0.5);
  float d = length(p);
  
  // 1. Ultra-Bright HDR Core (concentrated blinding white star core)
  float disc = smoothstep(0.015, 0.006, d) * 22.0;
  
  // 2. Medium Warm Corona (smooth, warm geocentric radial gradients)
  float innerCorona = exp(-d * 36.0) * 4.2;
  float outerCorona = exp(-d * 14.0) * 1.25;
  
  // 3. Large Cinematic Halo (extremely soft, vast screen-space presence)
  float largeHalo = exp(-d * 2.8) * 0.28;
  
  // 4. Subtle Optical Glare diffraction ring (restrained camera lens ghost)
  float lensRing = smoothstep(0.18, 0.20, d) * smoothstep(0.22, 0.20, d) * 0.04;
  
  // 5. Cinematic dual-layer horizontal anamorphic streak
  float wideStreak = exp(-abs(p.y) * 80.0) * exp(-abs(p.x) * 1.5) * 0.12;
  float coreStreak = exp(-abs(p.y) * 320.0) * exp(-abs(p.x) * 4.0) * 0.22;
  float horizontalStreak = wideStreak + coreStreak;
  
  // 6. Astrophotography Color Calibration
  vec3 discColor = vec3(1.00, 1.00, 1.00) * disc;
  vec3 innerColor = vec3(1.00, 0.94, 0.78) * innerCorona; // Creamy warm white
  vec3 coronaColor = vec3(0.96, 0.70, 0.38) * outerCorona; // Warm gold
  vec3 haloColor = vec3(0.95, 0.55, 0.25) * largeHalo; // Deep soft amber-orange
  vec3 streakColor = vec3(0.98, 0.84, 0.68) * horizontalStreak; // Warm peach
  vec3 ringColor = vec3(0.98, 0.72, 0.45) * lensRing; // Golden glare ring
  
  vec3 finalColor = discColor + innerColor + coronaColor + haloColor + streakColor + ringColor;
  
  // Set alpha as the combined luminance, capped at 1.0
  float alpha = clamp(disc + innerCorona + outerCorona + largeHalo + horizontalStreak + lensRing, 0.0, 1.0);
  
  gl_FragColor = vec4(finalColor, alpha);
}
