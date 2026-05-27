precision highp float;
varying vec2 vUv;

void main() {
  vec2 p = vUv - vec2(0.5);
  float d = length(p);
  
  // 1. Core solid solar disc (brilliant white star core)
  float disc = smoothstep(0.022, 0.016, d) * 12.0;
  
  // 2. High-fidelity solar corona (Mie scattering halo)
  // Sharp inner core decay, wide outer halo
  float innerHalo = exp(-d * 26.0) * 2.0;
  float outerHalo = exp(-d * 6.5) * 0.48;
  
  // 3. Ultra-restrained camera lens anamorphic flare
  // Very tight vertical falloff, wide horizontal spread
  float horizontalStreak = exp(-abs(p.y) * 150.0) * exp(-abs(p.x) * 3.5) * 0.08;
  
  // 4. Color calibration
  // Golden solar corona colors matching the SpaceX/NASA livestream reference perfectly
  vec3 discColor = vec3(1.00, 1.00, 1.00) * disc; // Brilliant white sun core
  vec3 innerColor = vec3(1.00, 0.88, 0.65) * innerHalo; // Warm cream-yellow halo
  vec3 outerColor = vec3(0.95, 0.68, 0.36) * outerHalo; // Rich golden-orange outer corona
  
  // Warm anamorphic lens streak tinted with soft warm peach-amber
  vec3 streakColor = vec3(0.98, 0.82, 0.62) * horizontalStreak;
  
  vec3 finalColor = discColor + innerColor + outerColor + streakColor;
  
  // Set alpha as the luminance value, capped at 1.0
  float alpha = clamp(disc + innerHalo + outerHalo + horizontalStreak, 0.0, 1.0);
  
  gl_FragColor = vec4(finalColor, alpha);
}
