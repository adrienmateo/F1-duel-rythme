# Duel de rythme F1

Deux usages, un seul calcul (dans `index.html`) :

- **Site** (`index.html`) : le GP raconté par les données, en deux niveaux (Essentiel et Expert) : résumé, course avec replay, rythme, duels entre coéquipiers (avec le circuit animé secteur par secteur), stratégies, explorateur. Tout est calculé dans le navigateur à partir d'OpenF1, sans IA.
- **Compte rendu par mail** (`report.mjs`) : **à la demande**, un clic dans GitHub Actions analyse le GP de ton choix (aucune exécution automatique, donc aucun coût caché).
  - **Avec Make** (recommandé) : les données partent vers un scénario Make. Claude rédige le résumé, Make envoie le mail et ajoute les duels dans un Google Sheet (historique de la saison). Guide : `make/GUIDE-MAKE.md`.
  - **Sans Make**, ou si Make est injoignable : GitHub envoie directement le mail factuel.

`report.mjs` lit le calcul directement dans `index.html` : si tu modifies une règle (seuil 107 %, tours exclus…), le mail suit automatiquement. Les deux fichiers doivent rester dans le même dossier.

---

## Mettre en place le compte rendu (≈ 15 min, une seule fois)

### 1. Créer un mot de passe d'application Gmail
1. Va sur <https://myaccount.google.com/apppasswords> (la validation en 2 étapes doit être activée sur ton compte).
2. Nom : `F1 compte rendu` → **Créer**.
3. Copie le code de 16 lettres. Il ne sera plus affiché ensuite.

Attention : ce code donne accès à toute la messagerie du compte (envoi et lecture), pas seulement à l'envoi. Utilise donc de préférence une **adresse Gmail dédiée** au projet, et mets ton adresse principale en destinataire (`MAIL_TO`). Tu peux révoquer le code à tout moment sur la même page.

### 2. Mettre le projet sur GitHub
1. Crée un dépôt **privé** sur GitHub (ex. `f1-duel-rythme`).
2. Envoie-y tout le contenu de ce dossier, y compris le dossier caché `.github/` (glisser-déposer dans « Add file → Upload files » fonctionne).

### 3. Ajouter les secrets
Dans le dépôt : **Settings → Secrets and variables → Actions**.

Onglet **Secrets** → *New repository secret* :

| Nom | Valeur |
|---|---|
| `GMAIL_USER` | ton adresse Gmail |
| `GMAIL_APP_PASSWORD` | le code de 16 lettres (sans espaces) |
| `MAIL_TO` | destinataire(s), séparés par des virgules. Facultatif : par défaut, le mail t'est envoyé |
| `NETLIFY_TOKEN` | jeton Netlify, pour lire les inscrits du site (voir « Inscriptions depuis le site ») |
| `MAKE_WEBHOOK_URL` | URL du webhook Make (voir `make/GUIDE-MAKE.md`). Facultatif : sans elle, le mail part directement de GitHub |

Onglet **Variables** (facultatif) : `DASHBOARD_URL` = l'adresse Netlify du dashboard, pour avoir un bouton « Ouvrir le dashboard » dans le mail.

### 4. Lancer un compte rendu
**Actions → Compte rendu GP → Run workflow**, trois réglages :

| Réglage | Effet |
|---|---|
| `session_key` | vide = dernier GP terminé ; sinon un GP précis |
| Résumé rédigé par Claude | coché : passe par Make et Claude (quelques centimes de crédit API) ; décoché : mail factuel envoyé directement par GitHub, **0 crédit** |
| Aperçu seulement | rien n'est envoyé ; l'aperçu du mail est téléchargeable en bas de la page du run (« compte-rendu ») |

Pour un premier essai, coche « Aperçu seulement ».

Pour un GP précis, renseigne son `session_key` OpenF1 (visible dans l'URL des appels du dashboard, ou via `https://api.openf1.org/v1/sessions?year=2026&session_name=Race`).

Rien ne tourne tout seul : chaque compte rendu correspond à un clic de ta part.

### Coûts, et comment les garder sous contrôle
- **GitHub Actions** : gratuit à ce volume (un run dure environ 1 minute).
- **Make** : le scénario ne consomme des opérations que lorsqu'il reçoit des données, donc seulement à tes lancements (environ 15 par GP ; l'offre gratuite suffit).
- **API Claude** : le seul poste payant, quelques centimes par résumé. Sur console.anthropic.com, partie facturation : fonctionne en **crédit prépayé**, **désactive le rechargement automatique** et fixe une **limite de dépense mensuelle**. Une fois le crédit épuisé, le mail part quand même, avec le texte de secours prévu dans Make.
- Pour 0 € : décoche « Résumé rédigé par Claude » au lancement.

---

## Inscriptions depuis le site (formulaire du dashboard)

Les visiteurs s'inscrivent (ou se désinscrivent) en bas du dashboard. Netlify enregistre les inscriptions ; au lancement du compte rendu, GitHub lit la liste et ajoute les inscrits en **copie cachée**. La dernière action de chaque adresse fait foi, et chaque mail contient un lien « Se désinscrire ».

Mise en place (une fois) :
1. **Netlify → Site configuration → Forms** : active la détection des formulaires (*Enable form detection*), puis redéploie (*Deploys → Trigger deploy*). Les formulaires `abonnement` et `desabonnement` apparaissent dans l'onglet **Forms**.
2. **Netlify → User settings → Applications → Personal access tokens** : *New access token*, nom `github-f1`. Copie-le.
3. **GitHub → Settings → Secrets and variables → Actions** :
   - secret `NETLIFY_TOKEN` = le jeton ;
   - variable `NETLIFY_SITE` = l'adresse du site sans `https://` (ex. `f1-automatisation.netlify.app`).

Au lancement, l'option « Envoyer aussi aux inscrits du site » (cochée par défaut) les inclut. Les inscriptions sont consultables dans Netlify → Forms.

## Contenu du mail
Points clés rédigés automatiquement · classement top 10 et abandons · remontées et chutes grille → arrivée · top 5 du rythme de course · les duels entre coéquipiers (écart et écart à pneus égaux, en secondes par tour) · stratégies (arrêts et pneus).

## En local
```bash
npm install
node report.mjs --dry-run --force   # aperçu dans out/report.html, sans envoi
```
Options : `--session <key>` (GP précis), `--force` (ignore la vérification « GP de moins de 8 jours », toujours activée depuis GitHub), `--dry-run` (pas d'envoi).

## Méthode
Tours exclus : départ, entrée et sortie des stands, neutralisations (messages de la direction de course + détection du peloton ralenti), tours au-delà de 107 % du médian du pilote. Rythme = temps médian des tours restants. Moins de 10 tours propres : pilote exclu de la comparaison. Tous les écarts sont en secondes par tour, y compris « à pneus égaux ».

## Modifier le site
`index.html` est assemblé à partir du dossier `src/` (`head.html`, `body.html`, `extra.css`, `app.js`). Après une modification dans `src/`, lance `python3 build.py`, puis envoie `index.html` (et `src/`) sur GitHub. Le bloc entre `/* ===== Calcul` et `/* ===== Rendu` de `app.js` est partagé avec `report.mjs`.

Données OpenF1 utilisées par le site : `sessions`, `drivers`, `laps` (temps et secteurs), `stints`, `pit`, `race_control`, `session_result`, `starting_grid`, et `location` (positions GPS des deux meilleurs tours d'un duel, pour le tracé du circuit, chargées seulement à l'ouverture de l'analyse).

## Tests (hors ligne, course simulée)
```bash
python3 test/fixture_data.py                                    # génère test/fixture/
F1_FIXTURES=test/fixture node report.mjs --dry-run --force      # compte rendu
python3 test/browser_test.py chemin/echarts.min.js /tmp           # site (Playwright, captures dans /tmp)
```

`compute_gaps.mjs` : ancienne version ligne de commande (export JSON), conservée pour un futur suivi sur toute une saison.
