# Limitations et dépendances restantes (état réel)

## Non opérationnel / non livré
- **Mode Unreal** : adaptateur et protocole seulement (voir UNREAL.md).
- **DWG, RVT, SKP, IFC** : refusés avec explication ; aucun convertisseur installé.
- **Supabase Auth / Storage** : non utilisés ; auth et stockage implémentés dans l'application (base compatible Supabase).
- **Export 4K** : désactivé (rendu logiciel sans GPU). 720p/1080p fonctionnent et sont vérifiés par ffprobe.
- **Communications automatiques** (e-mail/SMS/WhatsApp) : aucune ; les liens ouvrent la messagerie de l'utilisateur.
- **Reconnaissance IA des plans** : aucune transmission externe ; seule une détection locale simple de traits
  horizontaux/verticaux est proposée (résultats « proposés » à valider). Elle ne reconstruit ni façades ni cotes.
- **Navigation intérieure libre avec collisions** : non implémentée ; navigation intérieure par points de vue et
  parcours validés, plus coupe horizontale.

## Limites connues
- Rendu : la maquette de démonstration et les reconstructions sont des volumes simplifiés, couleurs unies, sans
  textures ni éclairage précalculé — **pas un rendu photoréaliste**. Les textures, mobilier détaillé et végétation
  réalistes doivent provenir de GLB fournis (ressources sous licence vérifiée par l'utilisateur). Le mobilier et la
  végétation de démo sont générés par code (aucune ressource tierce).
- DXF : LINE, LWPOLYLINE, POLYLINE de l'espace objet uniquement ; arcs, blocs (INSERT), cotes, textes ignorés.
- PDF : 40 premières pages converties à 110 dpi.
- Éditeur : murs droits ; pas de murs courbes ; les ouvertures ne se déplacent pas à la souris (édition numérique).
- Arabe : interface principale, statuts, types et présentation publique traduits ; certaines pages internes et les
  libellés saisis (points de vue, descriptions) restent en français ; la fiche PDF est en français (police standard sans arabe).
- Export vidéo lent (~0,3 s par image 1080p en rendu logiciel) ; durée maximale 180 s.
- Limiteur de tentatives en mémoire (une seule instance web).
- Favoris et comparaison : stockés dans le navigateur du visiteur.
- Les GLB très lourds (> 2 M triangles) ne sont pas optimisés automatiquement (pas de Draco/meshopt intégré à l'import).
- Les notes privées sont masquées aux lecteurs au niveau applicatif (la RLS isole par organisation, pas par colonne).
