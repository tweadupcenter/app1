# Guide administrateur

## Organisation et équipe
- **Équipe** : ajouter un membre (un mot de passe provisoire est affiché une seule fois ; aucun e-mail n'est envoyé),
  changer son rôle, le retirer. La base empêche de retirer le dernier administrateur.
- **Paramètres** : nom, couleur, logo, téléphone, e-mail, numéro WhatsApp (format international). Après modification,
  **republiez** les projets pour mettre à jour la présentation publique. Journal d'audit disponible.

## Projet
1. Créer le projet, ajouter bâtiments (nombre de niveaux, hauteur d'étage) et équipements réellement présents.
2. **Plans** : importer PDF/PNG/JPG/DXF. Le worker convertit (statut réel affiché). Pour chaque page : orientation,
   recadrage, calibration (deux points + cote connue), étage associé.
3. **Éditeur** : outils mur, pièce, porte, fenêtre, mesure ; grille, accrochage (Maj = angles de 45°), saisie numérique
   (longueur + angle), zoom (molette), déplacement, annuler/rétablir (Ctrl+Z / Ctrl+Y). Chaque enregistrement crée une
   version ; les versions précédentes se rouvrent depuis la liste. Validez les éléments après contrôle visuel.
   « Détecter les traits » est une aide locale facultative : résultats à corriger et valider.
4. **Aperçu 3D** : comparaison orthographique (plan en transparence) et tableau d'écarts de cotes. « Générer la maquette »
   crée une révision GLB à partir des seuls éléments validés et associe les pièces liées à des lots.
5. **Maquettes** : importer le GLB d'un architecte. Convention de nommage pour l'association automatique :
   `lot_<référence>`, `bld_<code>`, `floor_<code>_<niveau>`, `amenity_<pool|garden|sport|parking|playground>`.
   Sinon, associer manuellement en cliquant les objets. Après une nouvelle révision, vérifier le rapport
   (associations reportées / nœuds disparus) puis l'activer.
6. **Visite** : se placer, puis « Enregistrer la vue actuelle » ; le tableau sous la visite règle libellé, type, ordre,
   équipement lié et présence dans la barre. Un bouton d'équipement n'apparaît que si l'équipement existe.
7. **Ébauche dans la visite** : tant qu'aucune maquette n'est générée, la visite interne affiche le tracé des plans
   (validé ou non), coloré selon le statut des éléments, avec le plan dessous. Clic sur un mur = longueur, épaisseur,
   statut. Ce mode n'est jamais visible sur la présentation publique.
8. **Publication** : « Publier » fige une version publique ; « Révoquer » coupe immédiatement le lien et les fichiers publics.

## Lots
Statuts : Disponible, Option temporaire (durée obligatoire, expiration contrôlée par le serveur), Réservé, Vendu,
Indisponible. Motif obligatoire pour toute libération/vente/indisponibilité. Un commercial pose options et réservations
mais ne peut ni vendre, ni annuler une vente. Import CSV : aperçu obligatoire, annulation totale en cas d'erreur.

## CRM
Les demandes publiques créent ou complètent un prospect (étape « Nouveau », source « Site web »), une interaction, une
tâche de traitement et, pour un rendez-vous, un créneau « demandé — à confirmer ». Elles ne réservent jamais un lot.
Les communications automatiques sont désactivées.

## Médias et vidéos
Séquences : points de vue, durées, ordre, transitions (déplacement, coupe, fondu), 16:9 ou 9:16, titre, logo, musique
fournie (droits à la charge de l'utilisateur). « Exporter » ajoute un travail ; le fichier n'est proposé au
téléchargement qu'après vérification ffprobe (codec, dimensions, durée).

## Sauvegardes
- Base : `pg_dump -Fc immo360 > immo360-$(date +%F).dump` (quotidien conseillé), restauration `pg_restore -d immo360`.
- Fichiers : sauvegarder `STORAGE_DIR` (rsync / snapshot). Les deux sauvegardes doivent être faites ensemble.
