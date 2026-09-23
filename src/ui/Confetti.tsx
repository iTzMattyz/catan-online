import { useEffect, useRef } from 'react';

const GOLD = ['#f2c14e', '#ffe08a', '#f7f1e3'];
const LIFETIME_MS = 7000;

/** A one-off burst of paper confetti over the whole window, in the players' colours. */
export function Confetti({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const palette = [...colors, ...GOLD];
    const w = () => window.innerWidth;
    // Two cannons at the bottom corners, firing up and inwards.
    const bits = Array.from({ length: 220 }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) + (Math.random() - 0.5) * 40;
      const speed = 9 + Math.random() * 9;
      return {
        x: left ? 0 : w(),
        y: window.innerHeight,
        vx: Math.cos((angle * Math.PI) / 180) * speed,
        vy: Math.sin((angle * Math.PI) / 180) * speed,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
        flip: Math.random() * Math.PI,
        size: 6 + Math.random() * 6,
        color: palette[i % palette.length],
        delay: Math.random() * 500,
      };
    });

    const start = performance.now();
    let last = start;
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(2, (now - last) / 16.7);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fade = Math.min(1, (LIFETIME_MS - (now - start)) / 1200);
      for (const b of bits) {
        if (now - start < b.delay) continue;
        b.vy += 0.28 * dt;
        b.vx *= 0.99;
        b.vy = Math.min(b.vy, 4.5);
        b.x += b.vx * dt + Math.sin(b.flip) * 0.6;
        b.y += b.vy * dt;
        b.angle += b.spin * dt;
        b.flip += 0.12 * dt;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.scale(1, Math.cos(b.flip));
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 3, b.size, (b.size * 2) / 3);
        ctx.restore();
      }
      if (now - start < LIFETIME_MS) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
    // Fire once per mount; colours don't change at the end of a game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
