import React, { useEffect, useRef } from "react";

export type VisualizerVariant = "horizon" | "radial" | "aurora";

interface PartyVisualizerProps {
  variant: VisualizerVariant;
  level: number;
  isPlaying: boolean;
  accentRgb: [number, number, number];
  envelope?: number[];
  /** Optional normalized center point [0..1, 0..1] for radial mode */
  radialCenter?: [number, number];
  className?: string;
}

/** Derive a warm/cool complementary highlight color from the album's dominant RGB. */
function deriveSecondaryRgb([r, g, b]: [number, number, number]): [number, number, number] {
  // Subtle channel rotation + lift so every cover gets a rich dual-tone studio glow
  const r2 = Math.min(255, Math.round(b * 0.65 + r * 0.35 + 42));
  const g2 = Math.min(255, Math.round(r * 0.45 + g * 0.55 + 32));
  const b2 = Math.min(255, Math.round(g * 0.65 + b * 0.35 + 48));
  return [r2, g2, b2];
}

export const PartyVisualizer: React.FC<PartyVisualizerProps> = ({
  variant,
  level,
  isPlaying,
  accentRgb,
  envelope = [],
  radialCenter = [0.5, 0.5],
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({
    level,
    isPlaying,
    accentRgb,
    envelope,
    variant,
    radialCenter,
  });
  propsRef.current = { level, isPlaying, accentRgb, envelope, variant, radialCenter };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Persistent 60fps smoothing state
    let smoothLevel = 0;
    let rollingAvg = 0.15;
    let beatImpulse = 0;
    let phase = 0;
    let lastTime = performance.now();

    const BAR_COUNT = 56;
    const barHeights = new Float32Array(BAR_COUNT);
    const shockwaves: { radius: number; alpha: number }[] = [];

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const {
        level: rawLevel,
        isPlaying: playing,
        accentRgb: rgb,
        envelope: env,
        variant: mode,
        radialCenter: centerNorm,
      } = propsRef.current;

      const targetLevel = playing ? Math.max(0, Math.min(1, rawLevel * 1.35)) : 0;
      // Fast attack, silky exponential decay
      const attack = targetLevel > smoothLevel ? 18 : 6.5;
      smoothLevel += (targetLevel - smoothLevel) * Math.min(1, dt * attack);

      // Rolling energy average + transient beat detector
      rollingAvg += (smoothLevel - rollingAvg) * Math.min(1, dt * 2.2);
      const excess = smoothLevel - rollingAvg * 1.14;
      if (playing && excess > 0.06 && smoothLevel > 0.24) {
        const hit = Math.min(1, excess * 3.8);
        if (hit > beatImpulse) {
          beatImpulse = hit;
          if (mode === "radial" && shockwaves.length < 4 && hit > 0.35) {
            shockwaves.push({ radius: 138, alpha: 0.42 * hit });
          }
        }
      }
      beatImpulse *= Math.pow(0.03, dt);

      phase += dt * (playing ? 2.4 + smoothLevel * 4.2 : 0.45);

      const [r1, g1, b1] = rgb;
      const [r2, g2, b2] = deriveSecondaryRgb(rgb);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (mode === "horizon") {
        // Mirrored translucent spectrum bars along the bottom studio horizon
        const marginX = Math.max(24, width * 0.08);
        const usableW = Math.max(120, width - marginX * 2);
        const step = usableW / BAR_COUNT;
        const barW = Math.max(2.5, step * 0.56);
        const maxBarH = Math.min(110, height * 0.19);
        const baseY = height - 8;

        // Subtle glowing horizon mist
        const mistGrad = ctx.createLinearGradient(0, baseY - maxBarH * 1.35, 0, height);
        mistGrad.addColorStop(0, "rgba(0,0,0,0)");
        mistGrad.addColorStop(
          1,
          `rgba(${r1},${g1},${b1},${0.06 + smoothLevel * 0.14 + beatImpulse * 0.12})`
        );
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, baseY - maxBarH * 1.35, width, maxBarH * 1.35 + 8);

        for (let i = 0; i < BAR_COUNT; i++) {
          const norm = i / (BAR_COUNT - 1);
          // Symmetrical bell curve weighted toward center-low frequencies
          const distFromCenter = Math.abs(norm - 0.5) * 2;
          const bell = Math.pow(1 - distFromCenter * 0.72, 1.35);

          // Blend track energy envelope shape if available
          const envSample =
            env.length > 0
              ? env[Math.floor(norm * (env.length - 1))] ?? 0.5
              : 0.5;

          const wave =
            0.52 +
            0.28 * Math.sin(phase * 1.3 + i * 0.42) +
            0.2 * Math.cos(phase * 2.1 - i * 0.78);

          const targetH = playing
            ? Math.max(
                3,
                maxBarH *
                  bell *
                  (0.18 + smoothLevel * 0.92 + beatImpulse * 0.35 * (1 - distFromCenter * 0.5)) *
                  (0.55 + envSample * 0.35) *
                  wave
              )
            : 2.5;

          const speed = targetH > barHeights[i] ? 16 : 8;
          barHeights[i] += (targetH - barHeights[i]) * Math.min(1, dt * speed);

          const h = barHeights[i];
          const x = marginX + i * step + (step - barW) * 0.5;

          const barGrad = ctx.createLinearGradient(0, baseY - h, 0, baseY);
          barGrad.addColorStop(0, `rgba(${r2},${g2},${b2},${0.78 + beatImpulse * 0.2})`);
          barGrad.addColorStop(0.55, `rgba(${r1},${g1},${b1},0.58)`);
          barGrad.addColorStop(1, `rgba(${r1},${g1},${b1},0.16)`);

          ctx.fillStyle = barGrad;
          ctx.beginPath();
          ctx.roundRect(x, baseY - h, barW, h, [barW * 0.5, barW * 0.5, 0, 0]);
          ctx.fill();
        }

        // Crisp glowing baseline
        ctx.fillStyle = `rgba(${r2},${g2},${b2},${0.16 + smoothLevel * 0.32 + beatImpulse * 0.25})`;
        ctx.fillRect(marginX, baseY - 1, usableW, 1.5);
      } else if (mode === "radial") {
        // Circular radial pulse ring centered around the spinning vinyl record
        const cx = width * centerNorm[0];
        const cy = height * centerNorm[1];
        const baseRadius = Math.min(width, height) * 0.24;
        const spokes = 64;

        // Expanding beat shockwave rings
        for (let s = shockwaves.length - 1; s >= 0; s--) {
          const sw = shockwaves[s];
          sw.radius += dt * (110 + smoothLevel * 90);
          sw.alpha -= dt * 0.42;
          if (sw.alpha <= 0.01) {
            shockwaves.splice(s, 1);
            continue;
          }
          ctx.strokeStyle = `rgba(${r2},${g2},${b2},${sw.alpha})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Soft pulsing radial halo
        const haloRadius = baseRadius * (1.28 + smoothLevel * 0.25 + beatImpulse * 0.18);
        const halo = ctx.createRadialGradient(cx, cy, baseRadius * 0.6, cx, cy, haloRadius);
        halo.addColorStop(0, `rgba(${r1},${g1},${b1},0)`);
        halo.addColorStop(
          0.6,
          `rgba(${r1},${g1},${b1},${0.08 + smoothLevel * 0.16 + beatImpulse * 0.14})`
        );
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        // 64 Radial EQ spokes around the disc
        for (let i = 0; i < spokes; i++) {
          const angle = (i / spokes) * Math.PI * 2 + phase * 0.12;
          const wave =
            0.55 +
            0.27 * Math.sin(phase * 1.8 + i * 0.55) +
            0.18 * Math.cos(phase * 2.6 - i * 0.9);
          const spokeLen = playing
            ? 8 + (34 * smoothLevel + 24 * beatImpulse) * wave
            : 4;

          const x1 = cx + Math.cos(angle) * baseRadius;
          const y1 = cy + Math.sin(angle) * baseRadius;
          const x2 = cx + Math.cos(angle) * (baseRadius + spokeLen);
          const y2 = cy + Math.sin(angle) * (baseRadius + spokeLen);

          ctx.strokeStyle =
            i % 2 === 0
              ? `rgba(${r1},${g1},${b1},${0.32 + smoothLevel * 0.45})`
              : `rgba(${r2},${g2},${b2},${0.28 + beatImpulse * 0.45})`;
          ctx.lineWidth = 2.2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      } else {
        // "aurora": Dual-tone drifting ambient beat orbs + sleek bottom waveform ribbon
        const orb1X = width * (0.22 + 0.08 * Math.sin(phase * 0.28));
        const orb1Y = height * (0.3 + 0.08 * Math.cos(phase * 0.22));
        const orb1R = Math.min(width, height) * (0.36 + smoothLevel * 0.12 + beatImpulse * 0.09);

        const orb2X = width * (0.78 + 0.08 * Math.cos(phase * 0.25));
        const orb2Y = height * (0.68 + 0.08 * Math.sin(phase * 0.3));
        const orb2R = Math.min(width, height) * (0.34 + smoothLevel * 0.12 + beatImpulse * 0.09);

        const gA = ctx.createRadialGradient(orb1X, orb1Y, 0, orb1X, orb1Y, orb1R);
        gA.addColorStop(
          0,
          `rgba(${r1},${g1},${b1},${0.14 + smoothLevel * 0.16 + beatImpulse * 0.12})`
        );
        gA.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gA;
        ctx.fillRect(0, 0, width, height);

        const gB = ctx.createRadialGradient(orb2X, orb2Y, 0, orb2X, orb2Y, orb2R);
        gB.addColorStop(
          0,
          `rgba(${r2},${g2},${b2},${0.11 + smoothLevel * 0.14 + beatImpulse * 0.11})`
        );
        gB.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gB;
        ctx.fillRect(0, 0, width, height);

        // Sleek glowing wave ribbon along the bottom edge
        const ribbonY = height - 18;
        const amp = playing ? 6 + smoothLevel * 22 + beatImpulse * 14 : 1.5;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 10) {
          const norm = x / width;
          const taper = Math.sin(norm * Math.PI);
          const y =
            ribbonY -
            Math.abs(
              Math.sin(norm * 14 + phase * 1.4) * 0.65 +
                Math.cos(norm * 23 - phase * 2.1) * 0.35
            ) *
              amp *
              taper;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r2},${g2},${b2},${0.26 + smoothLevel * 0.45 + beatImpulse * 0.22})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 w-full h-full ${className}`}
    />
  );
};
