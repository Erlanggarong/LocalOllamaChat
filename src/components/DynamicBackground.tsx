"use client";

import React, { useEffect, useRef } from "react";

interface Props {
  theme: string;
}

// ========== PIXEL ANIME THEME ==========
function drawPixelAnime(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const stars: { x: number; y: number; size: number; opacity: number; twinkleSpeed: number; twinkleOffset: number }[] = [];
  const particles: { x: number; y: number; size: number; speedX: number; speedY: number; opacity: number; color: string }[] = [];

  for (let i = 0; i < 150; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.7,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.03 + 0.01,
      twinkleOffset: Math.random() * Math.PI * 2,
    });
  }
  const colors = ["#60a5fa", "#a78bfa", "#34d399", "#f472b6", "#fbbf24"];
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 3 + 1,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.5 + 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  function drawMountain(baseY: number, color: string, amplitude: number, frequency: number, offset: number) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 4) {
      const y = baseY + Math.sin((x + offset) * frequency) * amplitude;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();
  }

  function drawMoon(x: number, y: number, radius: number) {
    ctx.fillStyle = "#fef3c7";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    [{ cx: -8, cy: -5, r: 3 }, { cx: 6, cy: 8, r: 4 }, { cx: -4, cy: 10, r: 2 }].forEach((c) => {
      ctx.beginPath();
      ctx.arc(x + c.cx, y + c.cy, c.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTree(x: number, y: number, scale: number) {
    ctx.fillStyle = "#0f0a1a";
    ctx.fillRect(x, y - 10 * scale, 2 * scale, 10 * scale);
    const leafSize = 8 * scale;
    for (let row = 0; row < 4; row++) {
      const width = leafSize * (4 - row) / 2;
      ctx.fillRect(x - width / 2, y - 10 * scale - row * leafSize * 0.8, width, leafSize * 0.7);
    }
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0c0e1a");
    gradient.addColorStop(0.3, "#1a1d3a");
    gradient.addColorStop(0.5, "#2d1b4e");
    gradient.addColorStop(0.7, "#4a1c40");
    gradient.addColorStop(0.85, "#6b2d3a");
    gradient.addColorStop(1, "#1a1025");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const auroraGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    auroraGradient.addColorStop(0, "rgba(34, 197, 94, 0)");
    auroraGradient.addColorStop(0.2 + Math.sin(t * 0.3) * 0.1, "rgba(34, 197, 94, 0.08)");
    auroraGradient.addColorStop(0.5 + Math.sin(t * 0.2) * 0.15, "rgba(168, 85, 247, 0.1)");
    auroraGradient.addColorStop(0.8 + Math.sin(t * 0.25) * 0.1, "rgba(59, 130, 246, 0.08)");
    auroraGradient.addColorStop(1, "rgba(34, 197, 94, 0)");
    ctx.fillStyle = auroraGradient;
    ctx.fillRect(0, canvas.height * 0.2, canvas.width, canvas.height * 0.4);

    drawMoon(canvas.width * 0.85, canvas.height * 0.15, 30);

    const glowGradient = ctx.createRadialGradient(canvas.width * 0.85, canvas.height * 0.15, 30, canvas.width * 0.85, canvas.height * 0.15, 80);
    glowGradient.addColorStop(0, "rgba(254, 243, 199, 0.15)");
    glowGradient.addColorStop(1, "rgba(254, 243, 199, 0)");
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(canvas.width * 0.85, canvas.height * 0.15, 80, 0, Math.PI * 2);
    ctx.fill();

    stars.forEach((star) => {
      const twinkle = Math.sin(t * star.twinkleSpeed * 10 + star.twinkleOffset) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * twinkle})`;
      ctx.fillRect(Math.floor(star.x / 2) * 2, Math.floor(star.y / 2) * 2, Math.ceil(star.size), Math.ceil(star.size));
    });

    const shootingStarProgress = (t * 0.5) % 8;
    if (shootingStarProgress < 1) {
      const sx = canvas.width * 0.3 + shootingStarProgress * 300;
      const sy = canvas.height * 0.1 + shootingStarProgress * 150;
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - shootingStarProgress})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 30, sy - 15);
      ctx.stroke();
    }

    drawMountain(canvas.height * 0.65, "#1a1025", 40, 0.003, t * 5);
    drawMountain(canvas.height * 0.72, "#241533", 30, 0.004, t * 3 + 100);
    drawMountain(canvas.height * 0.78, "#2d1b42", 25, 0.005, t * 2 + 200);

    ctx.fillStyle = "#1a1025";
    ctx.fillRect(0, canvas.height * 0.85, canvas.width, canvas.height * 0.15);

    const treePositions = [0.05, 0.12, 0.25, 0.35, 0.48, 0.62, 0.75, 0.88, 0.95];
    treePositions.forEach((pos, i) => {
      const scale = 0.8 + Math.sin(t * 0.5 + i) * 0.1;
      drawTree(canvas.width * pos, canvas.height * 0.86 + (i % 3) * 5, scale);
    });

    particles.forEach((p) => {
      p.x += p.speedX; p.y += p.speedY;
      if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
      const particleTwinkle = Math.sin(t * 2 + p.x * 0.01) * 0.5 + 0.5;
      ctx.globalAlpha = p.opacity * particleTwinkle;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
    for (let y = 0; y < canvas.height; y += 3) ctx.fillRect(0, y, canvas.width, 1);

    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.8);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== CYBERPUNK THEME ==========
function drawCyberpunk(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const drops: { x: number; y: number; speed: number; length: number; opacity: number }[] = [];
  for (let i = 0; i < 80; i++) {
    drops.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      speed: Math.random() * 3 + 2,
      length: Math.random() * 20 + 10,
      opacity: Math.random() * 0.5 + 0.1,
    });
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#050510");
    gradient.addColorStop(0.5, "#0a0a1e");
    gradient.addColorStop(1, "#1a0a2e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Neon grid floor
    ctx.strokeStyle = "rgba(236, 72, 153, 0.15)";
    ctx.lineWidth = 1;
    const horizon = canvas.height * 0.6;
    for (let y = horizon; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    const gridOffset = (t * 20) % 40;
    for (let x = -canvas.width; x < canvas.width * 2; x += 60) {
      const offset = (x + gridOffset * 2) % (canvas.width * 2) - canvas.width;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 + offset * 0.3, horizon);
      ctx.lineTo(offset, canvas.height);
      ctx.stroke();
    }

    // Matrix rain
    drops.forEach((drop) => {
      drop.y += drop.speed;
      if (drop.y > canvas.height) {
        drop.y = -drop.length;
        drop.x = Math.random() * canvas.width;
      }
      const colors = ["#10b981", "#06b6d4", "#8b5cf6", "#ec4899"];
      ctx.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.globalAlpha = drop.opacity * 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x, drop.y + drop.length);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // City silhouette
    ctx.fillStyle = "#020205";
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    const buildings = [0.05, 0.1, 0.15, 0.22, 0.28, 0.35, 0.42, 0.48, 0.55, 0.62, 0.68, 0.75, 0.82, 0.88, 0.95];
    buildings.forEach((pos) => {
      const height = 50 + Math.sin(pos * 10 + t * 0.2) * 20;
      ctx.lineTo(canvas.width * pos, canvas.height - height);
      ctx.lineTo(canvas.width * (pos + 0.04), canvas.height - height);
    });
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    // Neon city lights
    buildings.forEach((pos) => {
      const height = 50 + Math.sin(pos * 10 + t * 0.2) * 20;
      const flicker = Math.sin(t * 3 + pos * 20) > 0.3;
      if (flicker) {
        ctx.fillStyle = `hsl(${pos * 360 + t * 10}, 80%, 60%)`;
        ctx.fillRect(canvas.width * pos + 2, canvas.height - height + 5, 3, 3);
      }
    });

    // Scanlines
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    for (let y = 0; y < canvas.height; y += 2) ctx.fillRect(0, y, canvas.width, 1);

    // Vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.4, canvas.width / 2, canvas.height / 2, canvas.height * 0.9);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== MINIMAL THEME ==========
function drawMinimal(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const particles: { x: number; y: number; size: number; speedX: number; speedY: number; opacity: number }[] = [];
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.2,
      speedY: (Math.random() - 0.5) * 0.2,
      opacity: Math.random() * 0.3 + 0.05,
    });
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0a0e17");
    gradient.addColorStop(0.5, "#111827");
    gradient.addColorStop(1, "#1e1b2e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle gradient orb
    const orbX = canvas.width * 0.5 + Math.sin(t * 0.1) * 100;
    const orbY = canvas.height * 0.3 + Math.cos(t * 0.15) * 50;
    const orbGradient = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 300);
    orbGradient.addColorStop(0, "rgba(59, 130, 246, 0.08)");
    orbGradient.addColorStop(0.5, "rgba(139, 92, 246, 0.04)");
    orbGradient.addColorStop(1, "rgba(59, 130, 246, 0)");
    ctx.fillStyle = orbGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    particles.forEach((p) => {
      p.x += p.speedX; p.y += p.speedY;
      if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
      const fade = Math.sin(t * 0.5 + p.x * 0.01) * 0.5 + 0.5;
      ctx.globalAlpha = p.opacity * fade;
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Very subtle vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.5, canvas.width / 2, canvas.height / 2, canvas.height);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.3)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== OCEAN THEME ==========
function drawOcean(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const bubbles: { x: number; y: number; r: number; speed: number; wobble: number }[] = [];
  for (let i = 0; i < 60; i++) {
    bubbles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 3 + 1,
      speed: Math.random() * 0.8 + 0.3,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0c1e3f");
    gradient.addColorStop(0.4, "#0a2d5c");
    gradient.addColorStop(0.7, "#084d7a");
    gradient.addColorStop(1, "#062a44");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Light rays from top
    for (let i = 0; i < 5; i++) {
      const x = canvas.width * (0.2 + i * 0.15) + Math.sin(t * 0.2 + i) * 30;
      const rayGradient = ctx.createLinearGradient(x, 0, x + 50, canvas.height * 0.6);
      rayGradient.addColorStop(0, `rgba(100, 200, 255, ${0.05 + Math.sin(t * 0.3 + i) * 0.02})`);
      rayGradient.addColorStop(1, "rgba(100, 200, 255, 0)");
      ctx.fillStyle = rayGradient;
      ctx.beginPath();
      ctx.moveTo(x - 20, 0);
      ctx.lineTo(x + 20, 0);
      ctx.lineTo(x + 80, canvas.height * 0.6);
      ctx.lineTo(x - 40, canvas.height * 0.6);
      ctx.closePath();
      ctx.fill();
    }

    // Wave layers
    for (let layer = 0; layer < 4; layer++) {
      const baseY = canvas.height * (0.55 + layer * 0.12);
      const alpha = 0.03 + layer * 0.02;
      ctx.fillStyle = `rgba(100, 200, 255, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let x = 0; x <= canvas.width; x += 5) {
        const y = baseY + Math.sin((x + t * 20 * (layer + 1)) * 0.005) * (15 + layer * 5);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.fill();
    }

    // Bubbles
    bubbles.forEach((b) => {
      b.y -= b.speed;
      if (b.y < -10) b.y = canvas.height + 10;
      const x = b.x + Math.sin(t + b.wobble) * 10;
      ctx.fillStyle = `rgba(150, 220, 255, ${0.3 + Math.sin(t * 2 + b.wobble) * 0.1})`;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.4, canvas.width / 2, canvas.height / 2, canvas.height);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 10, 30, 0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== SUNSET THEME ==========
function drawSunset(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const birds: { x: number; y: number; offset: number }[] = [];
  for (let i = 0; i < 8; i++) {
    birds.push({
      x: Math.random() * canvas.width,
      y: canvas.height * 0.25 + Math.random() * 100,
      offset: Math.random() * Math.PI * 2,
    });
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#1a0a2e");
    gradient.addColorStop(0.3, "#4a1a4a");
    gradient.addColorStop(0.5, "#8b2d3a");
    gradient.addColorStop(0.7, "#c44d2a");
    gradient.addColorStop(0.85, "#e87e1a");
    gradient.addColorStop(1, "#1a1025");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sun
    const sunY = canvas.height * 0.55 + Math.sin(t * 0.1) * 10;
    const sunGradient = ctx.createRadialGradient(canvas.width * 0.5, sunY, 20, canvas.width * 0.5, sunY, 120);
    sunGradient.addColorStop(0, "rgba(255, 200, 100, 0.9)");
    sunGradient.addColorStop(0.3, "rgba(255, 150, 50, 0.4)");
    sunGradient.addColorStop(1, "rgba(255, 100, 50, 0)");
    ctx.fillStyle = sunGradient;
    ctx.beginPath();
    ctx.arc(canvas.width * 0.5, sunY, 120, 0, Math.PI * 2);
    ctx.fill();

    // Sun core
    ctx.fillStyle = "#ffcc66";
    ctx.beginPath();
    ctx.arc(canvas.width * 0.5, sunY, 25, 0, Math.PI * 2);
    ctx.fill();

    // Clouds
    for (let i = 0; i < 5; i++) {
      const cx = ((canvas.width * 0.2 * i + t * 5) % (canvas.width + 200)) - 100;
      const cy = canvas.height * (0.15 + i * 0.05);
      ctx.fillStyle = `rgba(255, 150, 100, ${0.05 + i * 0.02})`;
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc(cx + j * 40, cy, 25 + j * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mountains
    ctx.fillStyle = "#0f0515";
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 5) {
      const y = canvas.height * 0.7 + Math.sin(x * 0.008) * 30 + Math.sin(x * 0.003) * 50;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    // Birds
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.lineWidth = 1.5;
    birds.forEach((bird) => {
      const bx = (bird.x + t * 15) % (canvas.width + 50) - 25;
      const by = bird.y + Math.sin(t + bird.offset) * 5;
      const wingY = Math.sin(t * 3 + bird.offset) * 4;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by - wingY);
      ctx.quadraticCurveTo(bx, by + 2, bx + 6, by - wingY);
      ctx.stroke();
    });

    // Vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.4, canvas.width / 2, canvas.height / 2, canvas.height);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== FOREST THEME ==========
function drawForest(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const leaves: { x: number; y: number; size: number; speedX: number; speedY: number; color: string; rotation: number }[] = [];
  const leafColors = ["#4ade80", "#22c55e", "#16a34a", "#84cc16", "#eab308"];
  for (let i = 0; i < 40; i++) {
    leaves.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 3 + 2,
      speedX: Math.random() * 0.5 + 0.2,
      speedY: Math.random() * 0.5 + 0.3,
      color: leafColors[Math.floor(Math.random() * leafColors.length)],
      rotation: Math.random() * Math.PI * 2,
    });
  }

  return () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#051a0f");
    gradient.addColorStop(0.4, "#0a2e1a");
    gradient.addColorStop(0.7, "#0f3d24");
    gradient.addColorStop(1, "#051a0f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fireflies
    for (let i = 0; i < 25; i++) {
      const fx = (canvas.width * 0.1 + (i * 37) % (canvas.width * 0.8) + Math.sin(t * 0.5 + i) * 50) % canvas.width;
      const fy = (canvas.height * 0.3 + (i * 23) % (canvas.height * 0.5) + Math.cos(t * 0.3 + i * 2) * 30) % canvas.height;
      const glow = Math.sin(t * 2 + i * 3) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(200, 255, 100, ${glow * 0.6})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 2 + glow, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tree silhouettes (back)
    ctx.fillStyle = "#0a1f12";
    for (let i = 0; i < 12; i++) {
      const tx = (canvas.width * 0.05 + i * canvas.width * 0.08) % canvas.width;
      const th = 100 + Math.sin(i * 3) * 30;
      ctx.fillRect(tx - 3, canvas.height - th, 6, th);
      // Canopy
      ctx.beginPath();
      ctx.arc(tx, canvas.height - th, 20 + Math.sin(t * 0.2 + i) * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fog/mist layers
    for (let i = 0; i < 3; i++) {
      const fogX = (t * 10 * (i + 1)) % (canvas.width + 400) - 200;
      const fogGradient = ctx.createLinearGradient(fogX, 0, fogX + 300, 0);
      fogGradient.addColorStop(0, "rgba(100, 150, 100, 0)");
      fogGradient.addColorStop(0.5, `rgba(100, 150, 100, ${0.03 + i * 0.01})`);
      fogGradient.addColorStop(1, "rgba(100, 150, 100, 0)");
      ctx.fillStyle = fogGradient;
      ctx.fillRect(fogX, canvas.height * (0.6 + i * 0.1), 300, 60);
    }

    // Falling leaves
    leaves.forEach((leaf) => {
      leaf.x += leaf.speedX + Math.sin(t + leaf.rotation) * 0.5;
      leaf.y += leaf.speedY;
      leaf.rotation += 0.02;
      if (leaf.x > canvas.width) leaf.x = -10;
      if (leaf.y > canvas.height) leaf.y = -10;
      ctx.save();
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.rotation);
      ctx.fillStyle = leaf.color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(-leaf.size / 2, -leaf.size / 2, leaf.size, leaf.size);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.4, canvas.width / 2, canvas.height / 2, canvas.height);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 10, 5, 0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

// ========== MIDNIGHT THEME ==========
function drawMidnight(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number) {
  const stars: { x: number; y: number; size: number; brightness: number; speed: number }[] = [];
  for (let i = 0; i < 300; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.8,
      size: Math.random() * 1.5 + 0.3,
      brightness: Math.random(),
      speed: Math.random() * 0.02 + 0.005,
    });
  }

  return () => {
    // Deep black background
    ctx.fillStyle = "#020205";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars
    stars.forEach((star) => {
      const twinkle = Math.sin(t * star.speed * 100 + star.brightness * 10) * 0.5 + 0.5;
      const alpha = star.brightness * twinkle;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Milky Way band
    const milkyWay = ctx.createLinearGradient(0, canvas.height * 0.2, canvas.width, canvas.height * 0.6);
    milkyWay.addColorStop(0, "rgba(100, 120, 180, 0)");
    milkyWay.addColorStop(0.3, `rgba(120, 140, 200, ${0.03 + Math.sin(t * 0.1) * 0.01})`);
    milkyWay.addColorStop(0.6, `rgba(140, 160, 220, ${0.04 + Math.cos(t * 0.15) * 0.01})`);
    milkyWay.addColorStop(1, "rgba(100, 120, 180, 0)");
    ctx.fillStyle = milkyWay;
    ctx.fillRect(0, canvas.height * 0.2, canvas.width, canvas.height * 0.4);

    // Aurora
    for (let band = 0; band < 3; band++) {
      const colors = [
        ["rgba(34, 197, 94, 0)", "rgba(34, 197, 94, 0.06)", "rgba(34, 197, 94, 0)"],
        ["rgba(168, 85, 247, 0)", "rgba(168, 85, 247, 0.05)", "rgba(168, 85, 247, 0)"],
        ["rgba(59, 130, 246, 0)", "rgba(59, 130, 246, 0.04)", "rgba(59, 130, 246, 0)"],
      ][band];
      const aurora = ctx.createLinearGradient(0, 0, canvas.width, 0);
      aurora.addColorStop(0, colors[0]);
      aurora.addColorStop(0.3 + Math.sin(t * 0.2 + band) * 0.1, colors[1]);
      aurora.addColorStop(0.7 + Math.cos(t * 0.15 + band) * 0.1, colors[1]);
      aurora.addColorStop(1, colors[0]);
      ctx.fillStyle = aurora;
      ctx.fillRect(0, canvas.height * (0.15 + band * 0.08), canvas.width, canvas.height * 0.15);
    }

    // Shooting stars
    for (let i = 0; i < 2; i++) {
      const progress = ((t * 0.3 + i * 4) % 10);
      if (progress < 1) {
        const sx = canvas.width * (0.2 + i * 0.3) + progress * 400;
        const sy = canvas.height * (0.1 + i * 0.05) + progress * 200;
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - progress})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 40, sy - 20);
        ctx.stroke();
      }
    }

    // Ground silhouette
    ctx.fillStyle = "#010103";
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let x = 0; x <= canvas.width; x += 10) {
      const y = canvas.height * 0.88 + Math.sin(x * 0.01) * 10;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    // Vignette
    const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.9);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
}

export default function DynamicBackground({ theme }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    let drawFrame: () => void;
    switch (theme) {
      case "cyberpunk":
        drawFrame = drawCyberpunk(ctx, canvas, timeRef.current);
        break;
      case "minimal":
        drawFrame = drawMinimal(ctx, canvas, timeRef.current);
        break;
      case "ocean":
        drawFrame = drawOcean(ctx, canvas, timeRef.current);
        break;
      case "sunset":
        drawFrame = drawSunset(ctx, canvas, timeRef.current);
        break;
      case "forest":
        drawFrame = drawForest(ctx, canvas, timeRef.current);
        break;
      case "midnight":
        drawFrame = drawMidnight(ctx, canvas, timeRef.current);
        break;
      default:
        drawFrame = drawPixelAnime(ctx, canvas, timeRef.current);
    }

    const draw = () => {
      timeRef.current += 0.016;
      drawFrame();
      frameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full -z-10"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
