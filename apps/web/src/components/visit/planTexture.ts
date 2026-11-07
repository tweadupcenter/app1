'use client';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { effectiveCrop, type PageGeom } from '@/lib/plan-transform';

/** Texture du plan (pivotée et recadrée comme dans l'éditeur), pour la superposer en 3D. */
export function usePlanTexture(url: string | null, g: PageGeom) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const c = effectiveCrop(g);
      const f = Math.min(1, 2048 / Math.max(c.w, c.h));
      const cv = document.createElement('canvas'); cv.width = Math.round(c.w * f); cv.height = Math.round(c.h * f);
      const ctx = cv.getContext('2d')!;
      ctx.scale(f, f); ctx.translate(-c.x, -c.y);
      if (g.rotation === 90) ctx.transform(0, 1, -1, 0, g.height, 0);
      if (g.rotation === 180) ctx.transform(-1, 0, 0, -1, g.width, g.height);
      if (g.rotation === 270) ctx.transform(0, -1, 1, 0, 0, g.width);
      ctx.drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; setTex(t);
    };
    img.src = url;
    return () => { alive = false; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return tex;
}

/** Dimensions (m) de la zone utile du plan dans le repère monde. */
export function planExtent(g: PageGeom) {
  const c = effectiveCrop(g), s = g.scale ?? 0.01;
  return { w: c.w * s, h: c.h * s };
}
