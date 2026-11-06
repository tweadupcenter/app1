# Mode Unreal Engine (Pixel Streaming)

**Statut : non opérationnel dans la livraison.** Aucun moteur Unreal, aucune scène empaquetée, aucun serveur de
signalisation ni machine GPU ne sont disponibles dans l'environnement de développement. Ce qui est livré :

- Contrat de messages commun Web/Unreal : `packages/core/src/unreal.ts` (types `ToEngine` / `FromEngine`).
- Adaptateur navigateur : `apps/web/src/lib/unreal-adapter.ts` (`UnrealSceneAdapter`, test de joignabilité du serveur
  de signalisation).
- Onglet « Mode Unreal » de la visite, qui liste les prérequis manquants (lus dans l'environnement).

## Prérequis manquants
1. Projet Unreal Engine 5.x avec le plugin **Pixel Streaming** activé, empaqueté (Windows/Linux).
2. Blueprint/acteur « ImmoBridge » dans la scène qui :
   - écoute les messages UI (`OnInputEvent` / `Pixel Streaming Input`) au format JSON ci-dessous ;
   - associe chaque acteur à un identifiant métier (tag `immo:lot:<uuid>`, `immo:floor:<uuid>`…) — mêmes UUID que la base ;
   - renvoie les événements via `Send Pixel Streaming Response` (`immo.lotClicked`, `immo.cameraChanged`…).
3. Serveur de signalisation (Signalling Web Server « Wilbur » d'Epic) accessible en WebSocket : `UNREAL_SIGNALLING_URL`.
4. Machine de rendu avec GPU et encodeur matériel (NVENC/AMF), `UNREAL_GPU_HOST`.
5. Bibliothèque frontale officielle `@epicgames-ps/lib-pixelstreamingfrontend-ue5.x` à ajouter à `apps/web`
   (version alignée sur la version du moteur) et à brancher sur `UnrealSceneAdapter`.

## Messages
Navigateur → moteur : `immo.loadProject`, `immo.gotoViewpoint` (pose + durée), `immo.selectLot`, `immo.selectBuilding`,
`immo.isolateFloor`, `immo.setLotStatuses`, `immo.section`, `immo.capture`.
Moteur → navigateur : `immo.ready`, `immo.lotClicked`, `immo.buildingClicked`, `immo.cameraChanged`, `immo.captureReady`, `immo.error`.

Les poses caméra utilisent le repère three.js (y vertical, mètres) : convertir vers le repère Unreal (z vertical,
centimètres) dans le Blueprint : `UE = (x·100, −z·100, y·100)`.
