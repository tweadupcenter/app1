'use client';
import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { Shot } from '@immo/core';
import type { SceneData } from '@/lib/scene-types';
import type { SceneApi } from '@/components/visit/Scene3D';

const Scene3D = dynamic(() => import('@/components/visit/Scene3D').then((m) => m.Scene3D), { ssr: false });

/** Scène pilotée image par image : window.__immoRenderFrame(t) positionne la caméra et effectue le rendu. */
export function RenderStage({ scene, shots, overlay }: { scene: SceneData; shots: Shot[]; overlay: { title: string; subtitle: string; logo: string | null; fictional: boolean } }) {
  const api = useRef<SceneApi | null>(null);
  const fade = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let loaded = false;
    const ready = () => { if (loaded && api.current) { api.current.renderAt(shots, 0); (window as any).__immoRenderReady = true; } };
    const onLoad = () => { loaded = true; setTimeout(ready, 300); };
    window.addEventListener('immo-scene-loaded', onLoad);
    (window as any).__immoRenderFrame = (t: number) => {
      if (!api.current) return false;
      const r = api.current.renderAt(shots, t);
      if (!r) return false;
      if (fade.current) fade.current.style.opacity = String(r.fade);
      if (title.current) title.current.style.opacity = String(t < 0.4 ? t / 0.4 : t < 3 ? 1 : Math.max(0, 1 - (t - 3) / 0.6));
      return true;
    };
    const timer = setTimeout(() => { if (!(window as any).__immoRenderReady) (window as any).__immoRenderError = 'chargement de la scène trop long'; }, 170_000);
    return () => { window.removeEventListener('immo-scene-loaded', onLoad); clearTimeout(timer); };
  }, [shots]);
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Scene3D data={scene} statusColors={false} selectedLotId={null} isolate={null} sectionHeight={null} flyTo={null} tour={null} renderMode
        initialPose={{ position: [80, 70, 90], target: [0, 0, 0], fov: 45 }} onReady={(a) => { api.current = a; }} onError={(e) => { (window as any).__immoRenderError = e.message; }} />
      <div ref={fade} style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none' }} />
      {(overlay.title || overlay.subtitle) && <div ref={title} style={{ position: 'absolute', insetInlineStart: '6%', bottom: '10%', color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.6)', fontFamily: 'system-ui, sans-serif', opacity: 0 }}>
        <div style={{ fontSize: '4.2vmin', fontWeight: 700 }}>{overlay.title}</div>
        <div style={{ fontSize: '2.4vmin' }}>{overlay.subtitle}</div>
      </div>}
      {overlay.logo && <img src={overlay.logo} alt="" style={{ position: 'absolute', top: '4%', insetInlineEnd: '4%', height: '7vmin' }} />}
      {overlay.fictional && <div style={{ position: 'absolute', top: '3%', insetInlineStart: '3%', color: '#fff', background: 'rgba(0,0,0,.45)', padding: '0.4vmin 1.2vmin', fontSize: '1.8vmin', borderRadius: 4, fontFamily: 'system-ui' }}>Projet fictif — démonstration</div>}
    </div>
  );
}
