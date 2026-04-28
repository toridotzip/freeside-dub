export const pulseShader = {
  uniforms: (color, halfSize, fillAxis, stripeAxis) => {
    return {
      uColor: { value: color },
      uOpacity: { value: 0.0 },
      uRadius: { value: 0.3 },
      uPhase: { value: 0.0 },
      uHalfSize: { value: halfSize },
      uFillAxis: { value: fillAxis },
      uStripeAxis: { value: stripeAxis },
    }
  },
  vertexShader: `
    varying vec3 vLocalPosition;

    void main() {
      vLocalPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uRadius;
    uniform float uPhase;
    uniform vec3 uHalfSize;
    uniform vec3 uFillAxis;
    uniform vec3 uStripeAxis;
    varying vec3 vLocalPosition;

    void main() {
      vec3 normalized = vLocalPosition / max(uHalfSize, vec3(0.001));
      float fillDistance = abs(dot(normalized, uFillAxis));
      float stripeDistance = dot(normalized, uStripeAxis);
      float pulse = 1.0 - smoothstep(uRadius, uRadius + 0.22, fillDistance);
      float stripe = 0.45 + 0.55 * sin((stripeDistance * 6.0 + uPhase) * 6.28318530718);
      float alpha = pulse * stripe * uOpacity;
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
};
