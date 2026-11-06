// Adaptateur Unreal Engine (Pixel Streaming). Le flux vidéo et le canal de données sont fournis par la
// bibliothèque officielle d'Epic (@epicgames-ps/lib-pixelstreamingfrontend-ue5.x), NON incluse ici :
// elle doit être ajoutée lors du déploiement d'une scène Unreal réelle (voir docs/UNREAL.md).
import type { FromEngine, ToEngine } from '@immo/core/unreal';
import { isFromEngine } from '@immo/core/unreal';

/** Interface minimale attendue de l'objet PixelStreaming d'Epic. */
export interface PixelStreamingLike {
  emitUIInteraction(payload: object | string): void;
  addResponseEventListener(name: string, listener: (response: string) => void): void;
  removeResponseEventListener?(name: string): void;
}

export class UnrealSceneAdapter {
  private listeners = new Set<(m: FromEngine) => void>();
  constructor(private ps: PixelStreamingLike) {
    ps.addResponseEventListener('immo', (raw) => {
      try { const m = JSON.parse(raw); if (isFromEngine(m)) this.listeners.forEach((l) => l(m)); } catch { /* message non JSON ignoré */ }
    });
  }
  send(msg: ToEngine) { this.ps.emitUIInteraction(msg); }
  on(l: (m: FromEngine) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  dispose() { this.ps.removeResponseEventListener?.('immo'); this.listeners.clear(); }
}

/** Vérifie seulement que le serveur de signalisation répond (ne prouve pas qu'un flux est disponible). */
export function probeSignalling(url: string, timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { resolve({ ok: false, detail: (e as Error).message }); return; }
    const t = setTimeout(() => { if (!done) { done = true; ws.close(); resolve({ ok: false, detail: 'délai dépassé' }); } }, timeoutMs);
    ws.onmessage = (ev) => { if (!done) { done = true; clearTimeout(t); ws.close(); resolve({ ok: true, detail: `premier message reçu : ${String(ev.data).slice(0, 80)}` }); } };
    ws.onerror = () => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, detail: 'connexion refusée ou impossible' }); } };
  });
}
