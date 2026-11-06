'use client';
import { useState } from 'react';
import { probeSignalling } from '@/lib/unreal-adapter';

/** Mode Unreal : n'est jamais présenté comme opérationnel sans moteur, scène et serveur. */
export function UnrealPanel({ config, projectId }: { config: { signallingUrl: string | null; missing: string[] }; projectId: string }) {
  const [probe, setProbe] = useState<string | null>(null);
  return (
    <div className="card" data-testid="unreal-panel">
      <h2>Mode Unreal Engine (Pixel Streaming)</h2>
      <div className="alert alert-warning"><b>Non opérationnel dans cet environnement.</b> L’adaptateur et le protocole sont livrés ; le rendu nécessite les éléments ci-dessous, absents ici.</div>
      <h3 style={{ marginTop: 12 }}>Prérequis manquants</h3>
      <ul>{config.missing.map((m) => <li key={m}>{m}</li>)}</ul>
      {config.signallingUrl && <div className="row">
        <button className="btn" onClick={async () => { setProbe('Test en cours…'); const r = await probeSignalling(config.signallingUrl!); setProbe(`${r.ok ? 'Serveur de signalisation joignable' : 'Échec'} : ${r.detail}`); }}>Tester le serveur de signalisation</button>
        {probe && <span className="small">{probe}</span>}
      </div>}
      <h3 style={{ marginTop: 12 }}>Identifiants partagés</h3>
      <p className="small">Le mode Unreal utilise les mêmes identifiants que le mode Web : projet <code>{projectId}</code>, bâtiments, étages, lots et points de vue (UUID de la base). Messages JSON échangés via <code>emitUIInteraction</code> / événement de réponse <code>immo</code> : <code>immo.selectLot</code>, <code>immo.gotoViewpoint</code>, <code>immo.isolateFloor</code>, <code>immo.setLotStatuses</code>, <code>immo.section</code> ; retours <code>immo.lotClicked</code>, <code>immo.cameraChanged</code>… (voir docs/UNREAL.md).</p>
    </div>
  );
}
