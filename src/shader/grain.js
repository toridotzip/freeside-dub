export const grainShader = {
  uniforms: {
    tDiffuse: { value: null },
    u_time: { value: 0 },
    u_strength: { value: 0.08 },
    u_scanline: { value: 0.18 },
    u_fringe: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float u_time;
    uniform float u_strength;
    uniform float u_scanline;
    uniform float u_fringe;

    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float vignette = smoothstep(0.95, 0.15, length(centered));
      vec2 fringeOffset = centered * (0.008 + u_fringe * 0.02);

      float r = texture2D(tDiffuse, vUv + fringeOffset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - fringeOffset).b;
      vec3 color = vec3(r, g, b);

      float scanline = sin((vUv.y + u_time * 0.08) * 1200.0) * u_scanline * 0.04;
      float grain = (rand(vUv + fract(u_time * 0.125)) - 0.5) * u_strength;

      color += grain;
      color -= scanline;
      color *= mix(0.82, 1.02, vignette);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
