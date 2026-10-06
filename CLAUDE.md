# Duel de rythme F1 — mémoire du projet

Projet perso d'Adrien-Matéo : site qui raconte chaque Grand Prix par les données OpenF1, plus un compte rendu par mail.
Site : https://adrienmateo.github.io/F1-duel-rythme/ (GitHub Pages, branche `main`, racine).
Dépôt : https://github.com/adrienmateo/F1-duel-rythme. L'ancienne adresse Netlify est figée (plus de crédits) : ne plus l'utiliser.

## Règles de travail (à respecter)
- Toujours discuter ou maquetter avant de coder une nouveauté ; poser les questions de choix avant de générer.
- Réponses directes et concises, en français.
- Aucun pourcentage affiché ; secondes au format français (`+0,374 s`, `1:41,2`).
- Le site n'appelle jamais Claude : tout est calculé dans le navigateur, règles fixes.
- Effets visuels sobres et modernes : « la donnée fait foi ».
- Mobile : vertical = changer de sujet, horizontal = changer de vue.
- Ne jamais montrer à l'utilisateur le message de limite d'appels OpenF1.
- Si une donnée manque, on ne l'affiche pas (bloc masqué) : jamais de phrase « OpenF1 ne donne pas… ». OpenF1 n'est cité qu'en source (pied de page, méthode).
- Aucun secret dans le dépôt. La clé Anthropic vit uniquement dans Make. Le mot de passe d'application Gmail est un secret GitHub (adresse Gmail dédiée conseillée).

## Public et direction
- Le public s'élargit des experts aux curieux : « gamification » = voir des voitures s'affronter plutôt que lire des courbes (pas un jeu).
- Mode Essentiel / Expert supprimé : les analyses détaillées sont dans la vue normale, en blocs repliés « Pour aller plus loin » avec un encadré « Ce que ça montre / Comment le lire », toujours à la fin d'un chapitre.
- Info générale dans les chapitres ; le choix des pilotes se fait dans « Compare les pilotes de ton choix » (Explorer).

## Construction
- `python3 build.py` assemble `index.html` : `src/head.html` + styles (`extra.css`, `mobile.css`, `pace.css`, `nav.css`) + `src/body.html` + UN seul `<script>` (`app.js`, `moments.js`, `mobile.js`, `pace.js`, `nav.js`, `wander.js`, `paddock.js`).
  Même portée pour tout le script : les fonctions sont hissées, les `const` ne le sont pas. Toujours éditer `src/`, puis relancer `build.py`.
- Le bloc « Calcul » de `index.html` (entre `/* ======================= Calcul` et `/* ======================= Rendu`) est relu par `report.mjs` et `archive.mjs` via `new Function` (`analyse`, `compactRace`, `gridFromPositions`) : ne pas casser ces repères.

## Fichiers clés
- `src/app.js` : données OpenF1 (`api()` limité à 28 appels/min, nouvel essai silencieux sur 429, message clair si OpenF1 est fermé), cache navigateur, rendu des chapitres et graphiques ECharts, Explorer.
- `src/nav.js` : accueil « Choisis ton Grand Prix » (à chaque ouverture), adresses `#<lieu>-<année>[/<chapitre>]`, sommaire en cartes « Comprendre la course » avec aperçus, chapitre ouvert en plein écran (mobile) ou en grand panneau (ordinateur : croix, Échap, clic à côté, bouton retour). Un seul chapitre à la fois dans l'historique.
  Chapitres : moments, course, duels, pneus (section `#strategies`), explorer. Le chapitre « Le rythme » est retiré pour l'instant (section `#rythme` gardée cachée dans le HTML, son code tourne encore).
- `src/pace.js` : haut de page. Feux de départ qui suivent le chargement, puis une F1 vue de dessus fait un tour sur le vrai tracé (meilleur tour du vainqueur) et se gare ; clic = un autre tour.
- `src/moments.js` : faits de course repérés par règles fixes (`buildFacts`, avec score : prise de tête durable — on ignore les échanges pendant les arrêts —, safety car / VSC / drapeau rouge et le pilote qui gagne le plus de places en s'arrêtant, gain au départ ≥ 3, abandon d'un pilote du top 10, plus belle remontée ≥ 5). Score pondéré par la position concernée (podium ×1,3, top 6 ×1,1, top 10 ×1, au-delà ×0,55), seuil 55, 5 faits au plus, un pilote une seule fois (sauf prise de tête) ; la frise en montre 4 au plus, plus l'arrivée (alimente aussi les notes du replay via `EVENTS`). Le chapitre « Les 3 moments » rejoue les 3 meilleurs (mini graphique des positions avec voitures, tour 0 = grille).
- `src/wander.js` : F1 qui se balade de temps en temps dans la marge (ordinateur) ou traverse « Chapitre suivant » (mobile). Jamais pendant l'accueil ni un chapitre ouvert sur ordinateur. Passage en 7 s dans la marge, ralenti à un quart de vitesse quand la souris la survole (zone de prise élargie). Easter egg ordinateur : on peut l'attraper (elle grossit et vibre sous la souris), au lâcher elle repart en dérapant et rapetisse.
- `src/paddock.js` : easter egg « pilotes à attraper ». Toutes les 1 min 30 à 3 min, un pilote agrippe le bas de l'écran (gants puis casque avec le numéro, regarde à gauche/droite, 3 s, figé au survol). Clic/toucher : figurine (casque blanc + couleur d'écurie, HANS, combinaison, numéro sur la poitrine, pas de visage ni de vrai casque/sponsor) qui grossit au centre, « Bravo ! », collection en localStorage `f1duel:paddock`. Sur 20 : 16 pilotes du GP affiché (non attrapés ×3), 2 vainqueurs dorés du GP affiché (un doré par GP), 1 safety car (si GP avec SC/VSC), 1 commissaire ou mécanicien. Accès « Ma collection » : bouton casque dans l'en-tête (ordinateur), bouton sur l'accueil, menu mobile, et lien en pied de page. Sauvegarde entre navigateurs : « Copier mon lien de sauvegarde » (`#paddock=<base64>`), ouvert ailleurs il fusionne la collection (`pkImport`, intercepté au début de `navRoute`). Pas de compte ni de serveur ; cookies inutiles (propres à chaque navigateur aussi). Maquette : artefact « Pilotes à attraper ».
- `src/mobile.js` : cartes à glisser par chapitre, Explorer mobile (raccourcis, pilotes, une carte par vue + « Sur le circuit »).
- `archive.mjs` + `.github/workflows/archiver-courses.yml` : chaque lundi (et à la main), archive les courses terminées depuis plus de 12 h dans `data/<session_key>.json` et `data/races-<année>.json` (vainqueur + petit tracé), commit par « archive-bot », relance Pages. Permet de voir les GP passés quand OpenF1 est fermé pendant les séances en direct. Le site lit `data/` en premier.
- `report.mjs` + `.github/workflows/compte-rendu-gp.yml` : compte rendu à la demande uniquement (pas de planification, pour maîtriser les crédits Claude). Avec Make (Claude rédige, Google Sheet d'historique) ou envoi direct par Gmail. Guide : `make/GUIDE-MAKE.md`.

## Contenu du site (état au 5 oct. 2026)
- Le GP en 30 s : titre, tracé + voiture, podium, « La course en un coup d'œil » (`renderFrise()` dans `moments.js` : frise T1 → arrivée, bandes jaunes = neutralisations, pastilles = faits à la couleur du pilote, 4 pastilles au plus, étiquettes sur 2 étages calculés à la mesure (décalage ≤ 70 px), sinon bascule automatique sur la liste verticale ; liste verticale sur mobile ; clic = détail), 2 chiffres clés seulement (écart à l'arrivée, plus belle remontée) pour éviter les doublons avec les chapitres.
- Les 3 moments : les tournants rejoués (voir `moments.js`).
- La course : graphique positions / écart au leader avec une petite F1 en tête de chaque ligne, replay, classement au tour ; « Pour aller plus loin » : les batailles à moins d'1 s.
- Les duels : une ligne par écurie (barre à la couleur de l'écurie, « VER › HAD +0,901 s », pastille STRAT si à pneus égaux le verdict s'inverse) ; lien « Voir deux pilotes sur le circuit » vers l'Explorer.
- Stratégies : relais de pneus ; plus loin : usure des pneus, arrêts aux stands chronométrés.
- Chaque chapitre a une ligne « Comment lire » toujours visible au-dessus du graphique (`renderHow()` dans `app.js`).
- Explorer (bouton « Afficher tous les tours » sur Temps au tour, comme le « Show outliers » de GP Tempo : ligne continue lissée comme GP Tempo ; avec la case, tous les tours sauf le tour 1, chaque point à la couleur du pneu, raison au survol ; 4 pilotes au maximum, un 5e est refusé avec un message ; « Comparé à » choisit le pilote de référence = `exSel[0]`, utilisé par Temps au tour, Écart en piste et Sur le circuit) : Temps au tour, Écart en piste, Régularité (une case par tour : vert dans son rythme ≤ 0,4 s au-dessus de sa médiane du relais carburant retiré, orange ≤ 1 s, rouge tour perdu, gris départ/stands/neutralisation), Sur le circuit (deux pilotes rejoués sur leur meilleur tour, secteur par secteur). L'onglet Pneus a été supprimé.

## Pièges connus
- Les heures de passage sont des sommes de temps au tour : elles dérivent. Le rendu les recale sur l'écart officiel à l'arrivée (`gap_to_leader`) pour les pilotes dans le même tour que le vainqueur.
- Médiane plutôt que moyenne pour le rythme : un tour perdu dans le trafic (sous les 107 %) ne fausse pas le résultat.
- OpenF1 bloque l'accès gratuit pendant les séances en direct, sans en-têtes CORS : `fetch` échoue, d'où l'archive `data/`.
- ECharts : un symbole `path://` avec `symbolKeepAspect: true` écrase la forme. Utiliser des chemins en L seulement, sans keepAspect (voitures en séries scatter sur deux couches).
- Clés de cache navigateur : `f1duel:v4:<sk>`, `f1duel:v4:trace:<sk>`, `f1duel:v4:races:<année>`.
- Ne jamais pousser un dossier `data/` produit par les tests (données factices).

## Tests
- `npm i echarts@5 --no-save` puis `python3 test/browser_test.py` (Playwright, OpenF1 simulé par `test/fixture_data.py`, ordinateur clair 1300 px + mobile sombre 390 px). Captures dans `/tmp`. Doit finir par « Erreurs JS : aucune » (hors polices Google bloquées).
- `archive.mjs` se teste contre une fausse API avec `OPENF1_API=http://localhost:8765/v1`, puis `rm -rf data`.

## À faire / en attente
- Lancer « Archiver les courses » dans Actions et vérifier que `data/` apparaît (sinon : Settings → Actions → Workflow permissions → Read and write).
- Mettre la variable `DASHBOARD_URL` sur l'adresse GitHub Pages.
- Remplacer l'inscription Netlify Forms par un webhook Make vers l'onglet « Abonnés » du Google Sheet, et faire lire les abonnés par `report.mjs`.
- Idées pour les curieux, à discuter : phrases clés en langage simple + glossaire, cartes de duel avec deux voitures, « Les 3 moments de la course », affiche partageable du GP.
- En pause : comparaison 3D des qualifs (projet futur).
- Lien prévu vers le site perso (domaine OVH).
