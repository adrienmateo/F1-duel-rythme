# Scénario Make : compte rendu F1 rédigé par Claude

```
GitHub Actions (lancé à la main) ── calcule le GP ──► POST JSON
                                                     │
 ① Webhooks · Custom webhook ◄───────────────────────┘
 ② Anthropic Claude · Create a Prompt        (rédige le résumé)
      └─ gestion d'erreur : Resume (texte de secours)
 ③ Router
      ├─ ④ Gmail · Send an email              (résumé + tableaux)
      └─ ⑤ Iterator (duels) → ⑥ Google Sheets · Add a row   (historique saison)
```

Coût : uniquement quand tu lances un compte rendu. Environ 15 opérations Make (offre gratuite suffisante) et quelques centimes d'API Claude. Pour ne rien dépenser, décoche « Résumé rédigé par Claude » au lancement dans GitHub : Make n'est alors pas appelé.

---

## Prérequis (10 min)

1. **Compte Make** gratuit : <https://www.make.com>
2. **Clé API Anthropic** : <https://console.anthropic.com> → *API Keys* → *Create Key*. Ajoute un petit crédit prépayé dans la partie facturation (quelques euros suffisent pour toute une saison), **désactive le rechargement automatique** et fixe une limite de dépense. Garde la clé de côté, elle ne s'affiche qu'une fois.
3. **Google Sheet** : crée une feuille « F1 – Historique des duels », renomme l'onglet `Duels`, puis colle en ligne 1 les en-têtes de `modele-historique-duels.csv` (Fichier → Importer → Importer → *Remplacer la feuille*, séparateur point-virgule).
   Vérifie *Fichier → Paramètres → Paramètres régionaux* = **France** : les écarts arrivent au format `0,244` et seront ainsi lus comme des nombres.

---

## Étape 1 · Webhook (le point d'entrée)

1. *Create a new scenario* → cliquer sur **+** → **Webhooks** → **Custom webhook**.
2. *Add* → nom : `F1 compte rendu` → *Save*. **Copie l'URL** affichée (`https://hook.eu2.make.com/…`).
3. Clique **Redetermine data structure** : Make attend un premier envoi.
4. Envoie l'exemple fourni, au choix :
   - **Postman** : `POST` sur l'URL, *Body → raw → JSON*, colle le contenu de `exemple-payload.json` → *Send* ;
   - **Terminal** : `curl -X POST -H "Content-Type: application/json" --data @make/exemple-payload.json "TON_URL"`
5. Make affiche *Successfully determined*. Tous les champs (`gp`, `claude_input`, `mail`, `duels`…) sont maintenant mappables.

## Étape 2 · Claude rédige le résumé

1. **+** après le webhook → **Anthropic Claude** → **Create a Prompt**.
2. *Create a connection* → colle ta clé API Anthropic.
3. Remplis les champs selon `consigne-claude.md` (modèle, max tokens, system prompt, message User avec `claude_input`).
4. **Filet de sécurité** : clic droit sur le module → *Add error handler* → **Resume**. Dans *Text Response*, mets :
   `<p><i>Résumé indisponible cette semaine : les chiffres ci-dessous restent à jour.</i></p>`
   Si l'API Claude échoue (crédit épuisé, panne), le mail part quand même.

## Étape 3 · Router

**+** après Claude → **Flow Control** → **Router**. Il crée deux branches qui s'exécutent l'une après l'autre.

## Étape 4 · Branche 1 : le mail

1. Branche du haut → **Gmail** → **Send an email**. Connecte ton compte Google.
2. Champs :
   - **To** : ton adresse (ou plusieurs)
   - **Subject** : `{{1.mail.objet}}`
   - **Content type / Body type** : **HTML** (*Raw HTML* selon la version)
   - **Content** : `{{replace(1.mail.html_template; 1.mail.marqueur; 2.Text Response)}}`

   Pour écrire la formule : ouvre l'onglet **fonctions texte** (icône *T*) du panneau de mapping, choisis `replace`, puis glisse les trois champs à leur place (séparés par des `;`). Ne tape pas les noms de champs à la main.

   La formule remplace le marqueur `[[RESUME_IA]]` du mail par le texte de Claude.
3. **Destinataires choisis au lancement** : active *Show advanced settings*, puis dans **Bcc** (copie cachée) bascule l'interrupteur **Map** et mets `{{1.destinataires}}`. Les adresses saisies dans GitHub (« Run workflow » → *destinataires*) reçoivent le mail en copie cachée ; **To** reste ta propre adresse. Laisse le champ vide au lancement pour un envoi à toi seul.

## Étape 5 · Branche 2 : l'historique de la saison

> **Mise à jour (écarts en secondes)** : les colonnes en pourcentage ont disparu. Dans ton Google Sheet, supprime les colonnes « Écart (%) » et « Pneus égaux (%) », ajoute « Pneus égaux (s/tour) » après « Écart (s/tour) », puis remappe le module Google Sheets selon le tableau ci-dessous (clique d'abord sur *Refresh* dans le module pour qu'il relise les en-têtes).

1. Branche du bas → **Flow Control** → **Iterator** → *Array* : `{{1.duels}}`.
2. **+** → **Google Sheets** → **Add a Row**.
   - *Spreadsheet* : « F1 – Historique des duels », *Sheet* : `Duels`, *Table contains headers* : **Yes**
   - Mappe chaque colonne avec les champs de l'Iterator (module 5) :

| Colonne | Champ |
|---|---|
| GP | `gp` |
| Date | `date` |
| Écurie | `ecurie` |
| Valide | `valide` |
| Pilote rapide | `pilote_rapide` |
| Pilote lent | `pilote_lent` |
| Écart (s/tour) | `ecart_s_fr` |
| Pneus égaux (s/tour) | `pneus_egaux_s_fr` |
| Commentaire | `commentaire` |

Utilise bien les champs `*_fr` (virgule décimale). Les champs sans `_fr` existent aussi si ta feuille est réglée en anglais.

## Étape 6 · Activer

1. *Run once* puis renvoie l'exemple (Postman ou curl) : vérifie le mail reçu et les lignes ajoutées (une par écurie). Supprime ensuite ces lignes de test dans le Sheet.
2. Enregistre le scénario, *Scheduling* → **Immediately as data arrives**, puis bascule le scénario sur **ON**. Ce n'est pas une récurrence : le scénario dort et ne consomme rien tant que GitHub ne lui envoie pas de données, c'est-à-dire seulement quand tu lances le compte rendu.

## Étape 7 · Brancher GitHub sur Make

Dans le dépôt GitHub : *Settings → Secrets and variables → Actions → New repository secret* :
- `MAKE_WEBHOOK_URL` = l'URL copiée à l'étape 1.

Garde `GMAIL_USER` et `GMAIL_APP_PASSWORD` : si Make est injoignable, GitHub envoie lui-même le mail factuel (sans résumé IA).

**Test de bout en bout** : *Actions → Compte rendu GP → Run workflow*, « Résumé rédigé par Claude » coché. Le run GitHub affiche « Données envoyées au scénario Make », et l'historique Make montre l'exécution.

---

## Pour aller plus loin
- **Tendances** : dans le Sheet, un tableau croisé dynamique *Écurie × Écart (s/tour)* (moyenne), puis un graphique en courbes par GP. C'est l'objectif de départ du projet.
- **Une branche de plus** : publier le résumé dans Notion, sur Slack, ou préparer un brouillon de post LinkedIn.
- **Sur ta vitrine** : une capture du scénario Make, le schéma ci-dessus et un exemple de mail reçu.
