import { memo, useEffect, useRef } from 'react';

export default memo(function NebulaBackground({ active = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, width = 1, height = 1, time = 0, previous = null;
    // Canvas adaptation of the cloud/star treatment described at:
    // https://www.shadcn.io/background/nebula (not copied registry source).
    // Cache soft clouds so animation only composites small textures each frame.
    const colors = ['139, 70, 220', '213, 57, 142', '31, 153, 185', '103, 83, 214', '206, 123, 67', '85, 52, 177'];
    const clouds = colors.map((color, i) => {
      const texture = document.createElement('canvas');
      texture.width = texture.height = 256;
      const brush = texture.getContext('2d');
      const gradient = brush.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, `rgba(${color}, .48)`);
      gradient.addColorStop(.4, `rgba(${color}, .22)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);
      brush.fillStyle = gradient;
      brush.fillRect(0, 0, 256, 256);
      return { texture, x: .15 + (i % 3) * .35, y: .25 + Math.floor(i / 3) * .5, phase: i * 2.4 };
    });
    const stars = Array.from({ length: 75 }, () => ({
      x: Math.random(), y: Math.random(), radius: .4 + Math.random() * .8,
      phase: Math.random() * Math.PI * 2,
    }));
    function draw() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#090d20';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      const size = Math.max(width, height) * .95;
      clouds.forEach(({ texture, x, y, phase }) => {
        const cx = (x + Math.sin(time * .32 + phase) * .22) * width;
        const cy = (y + Math.cos(time * .26 + phase) * .18) * height;
        const cloudSize = size * (1 + Math.sin(time * .24 + phase) * .12);
        ctx.drawImage(texture, cx - cloudSize / 2, cy - cloudSize * .4, cloudSize, cloudSize * .8);
      });
      ctx.fillStyle = '#dfecff';
      stars.forEach(star => {
        ctx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(time * .65 + star.phase));
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    function animate(timestamp) {
      if (previous === null || timestamp - previous >= 1000 / 30) {
        // Use elapsed time so slow kiosk frames don't slow down the drift.
        time += previous === null ? 0 : (timestamp - previous) / 1000;
        previous = timestamp;
        draw();
      }
      frame = requestAnimationFrame(animate);
    }
    function sync() {
      cancelAnimationFrame(frame);
      previous = null;
      draw();
      if (!document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(animate);
    }
    function resize() {
      const bounds = canvas.getBoundingClientRect();
      // Limit resolution for kiosk hardware; the clouds are deliberately soft.
      const scale = Math.min(1, 1000 / Math.max(1, bounds.width));
      width = canvas.width = Math.max(1, Math.round(bounds.width * scale));
      height = canvas.height = Math.max(1, Math.round(bounds.height * scale));
      draw();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    resize();
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, [active]);

  return active ? <canvas ref={canvasRef} aria-hidden="true" className="k-nebula" /> : null;
});
