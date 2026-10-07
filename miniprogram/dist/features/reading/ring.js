"use strict";

// Reading-ring presentation only; totals and streak rules remain in model.js.
// Use basic native Canvas 2D paths, not the browser-only conic-gradient API.
function drawRing2d(ctx, width, height, minutes, goal) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 8) return;
  const size = Math.min(width, height),
    cx = width / 2,
    cy = height / 2;
  const stroke = size * 0.20,
    outer = size / 2 - 2,
    radius = outer - stroke / 2;
  const inner = outer - stroke,
    turn = Math.PI * 2,
    origin = -Math.PI / 2;
  const ratio = Number.isFinite(minutes) && Number.isFinite(goal) && goal > 0 ? minutes / goal : 0;
  const progress = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  const sweep = Math.min(progress, 1) * turn;
  const end = origin + progress % 1 * turn,
    from = end - sweep;
  const first = [103, 52, 222],
    last = [155, 87, 245];
  function color(t) {
    return `rgb(${first.map((value, i) => Math.round(value + (last[i] - value) * t)).join(',')})`;
  }
  function annulus() {
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, turn);
    ctx.arc(cx, cy, inner, turn, 0, true);
    ctx.closePath();
  }
  function cap(angle) {
    ctx.beginPath();
    ctx.arc(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), stroke / 2, 0, turn);
    ctx.fill();
  }
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  annulus();
  ctx.fillStyle = '#d8c8f0';
  ctx.fill();
  if (progress > 0) {
    // Only the last revolution is visible. This bounds the drawing cost even
    // after many goals, and keeps the gradient attached to the advancing head.
    ctx.fillStyle = color(0);
    if (progress < 1) cap(from);
    const steps = Math.max(1, Math.ceil(sweep * radius * 1.25)),
      overlap = 0.75 / radius;
    ctx.lineWidth = stroke;
    ctx.lineCap = 'butt';
    for (let i = 0; i < steps; i++) {
      const a = from + sweep * i / steps,
        b = from + sweep * (i + 1) / steps;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.max(from, a - overlap), Math.min(end, b + overlap));
      ctx.strokeStyle = color((i + 0.5) / steps);
      ctx.stroke();
    }
    // Keep the round head at exact 100%, 200%, ... as well. It overlaps the
    // darker start of the preceding revolution, just like an activity ribbon.
    ctx.fillStyle = color(1);
    if (progress >= 0.85) {
      ctx.save();
      annulus();
      ctx.clip();
      const nx = Math.cos(end),
        ny = Math.sin(end),
        tx = -ny,
        ty = nx;
      const x = cx + radius * nx,
        y = cy + radius * ny,
        reach = size * 2;
      ctx.beginPath();
      ctx.moveTo(x - nx * reach, y - ny * reach);
      ctx.lineTo(x + nx * reach, y + ny * reach);
      ctx.lineTo(x + nx * reach + tx * reach, y + ny * reach + ty * reach);
      ctx.lineTo(x - nx * reach + tx * reach, y - ny * reach + ty * reach);
      ctx.closePath();
      ctx.clip();
      ctx.shadowColor = `rgba(38,24,76,${Math.min(1, (progress - 0.85) / 0.15) * 0.45})`;
      ctx.shadowBlur = stroke * 0.20;
      ctx.shadowOffsetX = tx * stroke * 0.12;
      ctx.shadowOffsetY = ty * stroke * 0.12;
      cap(end);
      ctx.restore();
    }
    cap(end);
  }
  ctx.restore();
}
function animateRing({
  canvas,
  context,
  width,
  height,
  fromMinutes,
  minutes,
  goal,
  isCurrent,
  onFrame
}) {
  let stopped = false,
    frameId,
    began;
  const valid = () => !stopped && isCurrent();
  const draw = value => {
    drawRing2d(context, width, height, value, goal);
    onFrame(value);
  };
  // Animate at most one and a half turns on a first display or a large jump.
  // This changes only the presentation; the statistics always show real totals.
  const initial = Math.max(Number.isFinite(fromMinutes) ? fromMinutes : 0, minutes - goal * 1.5);
  const cancel = () => {
    stopped = true;
    if (frameId !== undefined && canvas.cancelAnimationFrame) canvas.cancelAnimationFrame(frameId);
  };
  if (!valid()) return cancel;
  if (!canvas.requestAnimationFrame || Math.abs(initial - minutes) < 0.01) {
    draw(minutes);
    return cancel;
  }
  draw(initial);
  const frame = timestamp => {
    frameId = undefined;
    if (!valid()) return;
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (began === undefined) began = now;
    const t = Math.min(1, Math.max(0, (now - began) / 650)),
      eased = 1 - Math.pow(1 - t, 3);
    draw(initial + (minutes - initial) * eased);
    if (t < 1) frameId = canvas.requestAnimationFrame(frame);
  };
  frameId = canvas.requestAnimationFrame(frame);
  return cancel;
}
module.exports = {
  drawRing2d,
  animateRing
};
