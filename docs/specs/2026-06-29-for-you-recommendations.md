# Spec — Feed "Pour toi" (recommandations crowd MAL, seedées)

**Date:** 2026-06-29
**Statut:** Design validé, prêt pour implémentation (writing-plans)
**Auteur:** Brainstorming Xavier + Claude

> Ce document est auto-suffisant : une session fraîche doit pouvoir implémenter sans re-déduire les décisions. Tout le contexte, les findings empiriques, les formules et les ancres dans le code existant sont ici.

---

## 1. Objectif

Ajouter un moteur de **recommandation d'animes** à l'app. C'est la fonctionnalité la plus désirée par l'utilisateur. Le but : surfacer des titres **que l'utilisateur n'a PAS vus**, alignés sur son goût, avec un accent sur la **découverte de titres nichés**.

### Hors scope (décidé)
- **Stats de visionnage / historique / temps passé** → géré par SIMKL, ne jamais ré-implémenter.
- **SIMKL comme source** → SIMKL est synchronisé avec MAL, donc la liste MAL fait foi pour le filtre "déjà vu". Pas d'intégration SIMKL.

---

## 2. Exigence n°1 (NON NÉGOCIABLE)

**Le feed ne montre JAMAIS un titre déjà vu.** L'utilisateur a beaucoup regardé et exige zéro pollution.

Filtre dur : exclure tout candidat dont `my_list_status.status ∈ { completed, watching, on_hold, dropped }`.

`plan_to_watch` est **autorisé** dans le feed (pas encore vu, découverte légitime — surface des titres planifiés mais oubliés).

> Garantie limitée par l'exhaustivité de la liste MAL. Validé OK : SIMKL est synchro avec MAL, donc la liste MAL est considérée complète.

---

## 3. Findings empiriques (mesurés le 2026-06-29 sur data fraîche)

Data : `E:\Workspace\local\AnimeTracker\data\` (token MAL inclus pour tests).

### 3.1 Volume des graines — feed PAS famélique ✅
- Dataset total : **13 003** animes
- Liste MAL : **385** (status : completed 265, dropped 79, watching 20, plan_to_watch 21)
- "Déjà vu" (completed/watching/on_hold/dropped) : **364** → le filtre dur retire peu en proportion de 13 003. Risque de feed vide = faible.
- **Graines `completed && score ≥ 8` : 137** (≥9 → 82, ≥10 → 38, ≥7 → 178). Seuil 8 confortable.
- Histogramme des notes (in-list) : `{0:114, 4:13, 5:34, 6:25, 7:47, 8:62, 9:49, 10:38}` — l'utilisateur note peu au-dessus de 8, d'où **seuil paramétrable**.

### 3.2 Champ `recommendations` — VALIDE ✅
`GET https://api.myanimelist.net/v2/anime/{id}?fields=recommendations` (auth Bearer) → 200.
Renvoie `recommendations: [{ node: {id, title, main_picture}, num_recommendations }]`.
- Exemple Steins;Gate (9253) → Re:Zero (136 backers), Erased (133), Madoka (53)…
- ⚠️ **Plafonné à 10 recos par anime.** Donc 137 graines × ≤10 ≈ ~1370 edges bruts → quelques centaines de candidats uniques après dédup. Suffisant.

### 3.3 `/v2/anime/suggestions` — PERSONNALISÉ ✅ (contre-intuitif)
`GET https://api.myanimelist.net/v2/anime/suggestions?limit=N&fields=...` (auth Bearer) → 200.
- **N'est PAS** le listing générique de `recommendations.php`. Réponse perso et éclectique (Tsuki ga Kirei, Kono Oto Tomare!, Carnival Phantasm, Zetsubou Sensei…).
- **0/10 déjà dans la liste** : MAL exclut nativement le déjà-vu.
- → Source de candidats gratuite, perso, orthogonale au crowd-seed. **Incluse en v1.**

---

## 4. Sources de candidats

Tous les candidats passent par le filtre dur "0 déjà-vu" (§2) + exclusion `dismissed` + `hidden`.

| # | Source | Coût | v1 ? |
|---|--------|------|------|
| 1 | **Crowd-seed 1-hop** : recos MAL des graines | borné (≤137 + manquants) | ✅ |
| 2 | **MAL suggestions** : endpoint perso `/v2/anime/suggestions` | cheap (1 appel paginé) | ✅ |
| 3 | **Toggle "mode niche" 2-hop** : recos des candidats 1-hop, damping λ | lourd (×3-5) | ✅ (toggle, off par défaut) |
| 4 | **Tags AniList** : tags granulaires + graphe reco AniList | nouvelle intégration | ❌ Backlog |

### 4.1 Graines (seeds)
- Définition : `my_list_status.status === 'completed' && my_list_status.score >= SEUIL`.
- `SEUIL` **paramétrable** depuis l'UI (défaut **8**). Baisser → plus de graines, plus de volume.
- Poids d'une graine : `poids = score - (SEUIL - 1)` (avec SEUIL=8 : 8→1, 9→2, 10→3). S'adapte si SEUIL change.

### 4.2 Crowd-seed 1-hop
Pour chaque graine, fetch `recommendations` → edges `{ recId, num_recommendations, hop: 1, viaSeedId }`.

### 4.3 MAL suggestions
Fetch `/v2/anime/suggestions` (paginer si besoin). Chaque item devient un candidat avec un **boost de base** dédié (source perso fiable). Déjà filtré déjà-vu côté MAL, re-filtrer par sécurité.

### 4.4 Mode niche 2-hop (toggle, off par défaut)
Quand activé, le refresh fetch aussi les `recommendations` de chaque candidat 1-hop → edges `{ recId, num_recommendations, hop: 2, viaSeedId }`. Refresh sensiblement plus long. Damping appliqué au ranking (§5), pas au fetch.

---

## 5. Algorithme de ranking (calcul à la volée, cheap)

Le **fetch** (coûteux) est séparé du **ranking** (cheap, recalculé à chaque visite du feed depuis les edges stockés). Changer un knob de ranking ne nécessite PAS de re-fetch.

### 5.1 Score d'affinité par candidat
```
affinité(c) = Σ_edges(c) [ num_recommendations(edge) × poids_graine(edge.viaSeedId) × λ^(hop-1) ]
            + boost_suggestion(c)          // si présent dans MAL suggestions
```
- `λ` (damping niche) : edge 1-hop → λ⁰=1 ; edge 2-hop → λ¹≈**0.3** (constante ajustable).
- `boost_suggestion` : valeur constante (à caler, ex. médiane des affinités 1-hop) pour que les suggestions perso pèsent sans écraser.

### 5.2 Knobs de ranking (d'office en v1)
- **Pénalité popularité** (levier niche cheap) : `score_final = affinité(c) / log10(max(num_list_users(c), 10))`. Fait remonter les titres recommandés dans le cluster de goût mais peu mainstream.
- **Signal négatif** : construire un profil de rejet depuis `dropped` + notes basses (≤ 5). Pour chaque candidat, pénaliser selon le recoupement genres/studios avec ce profil. `score_final *= (1 - pénalité_négative(c))`. Le crowd ne connaît pas les rejets de l'utilisateur — signal unique.
- **Booster affinité genre/studio** : profil positif depuis les bonnes notes (genres/studios des graines pondérés par note). `score_final *= (1 + α × affinité_genre_studio(c))`. Resserre sur le goût.

> Toutes les constantes (λ, boost_suggestion, α, seuil note négative) en **constantes nommées** dans un module dédié, faciles à tuner. Pas de magic numbers épars.

### 5.3 Filtres durs (appliqués avant ranking)
1. Exclure si `my_list_status.status ∈ {completed, watching, on_hold, dropped}` (déjà-vu).
2. Exclure si `id ∈ recommendations_dismissed.json`.
3. Exclure si `id ∈ animes_hidden.json` (respecter le hide global).

### 5.4 Tri
Par `score_final` décroissant, départage par `mean` décroissant.

---

## 6. Modèle de données / stockage

Tout sous `DATA_PATH` (JSON, pas de DB — cf. CLAUDE.md).

### 6.1 Nouveaux fichiers
- **`recommendations_MAL.json`** — données brutes fetchées :
  ```json
  {
    "lastRefresh": "2026-06-29T05:10:00Z",
    "seedThreshold": 8,
    "nicheMode": false,
    "seeds": { "9253": [ { "id": 31240, "num": 136, "hop": 1 }, ... ] },
    "suggestions": [ { "id": 37510, "rank": 1 }, ... ]
  }
  ```
  (`seeds` keyé par seedId → edges ; `hop` permet d'inclure/exclure le 2-hop au ranking sans re-fetch.)
- **`recommendations_dismissed.json`** — `number[]` des IDs écartés (séparé de `animes_hidden.json`).

### 6.2 Réutilisation de l'existant
- Les **titres recommandés absents** du dataset sont fetchés en détail complet (avec `my_list_status`) et insérés via **`saveMALAnime(animeData: Record<string, MALAnime>)`** ([src/lib/anime.ts](../../src/lib/anime.ts)) — qui invalide le cache.
- Lecture des animes via **`getAnimeForDisplay()`** (cache 10 min, [src/lib/anime.ts](../../src/lib/anime.ts)).
- Hidden : `getHiddenAnimeIds()`, `addHiddenAnimeId()`.
- Auth : `getMALAuthData()`, `isMALTokenValid()`. `mal_auth.json` a la forme `{ user, token: { access_token, ... } }`.

---

## 7. Architecture & flux

### 7.1 Point critique : le feed ne rentre PAS dans le moule existant
CLAUDE.md : l'URL est la source de vérité, les presets → params de filtre → `/api/anime/animes` qui applique filtre+tri via `animeUtils`. **Mais** `for_you` est un **ranking calculé** sur un set de candidats : le score d'affinité n'est pas un `SortColumn`, la sélection de candidats n'est pas un `AnimeFilters`. → **Chemin dédié.**

### 7.2 Endpoints (nouveaux, sous `src/pages/api/anime/recommendations/`)
- **`GET /api/anime/recommendations`** — calcule et renvoie le feed rankngé (cheap, live). Query params : `nicheMode` (bool, applique λ aux edges hop=2), `threshold` (override seuil graine pour le ranking — note : changer le seuil pour AJOUTER des graines nécessite un re-fetch ; pour en RETIRER, filtrage live suffit). Réponse : liste d'`AnimeForDisplay` enrichie d'un champ `recoMeta { affinityScore, topSeeds: [{id,title,backers}], fromSuggestions: bool }`.
- **`POST /api/anime/recommendations/refresh`** — lance le fetch coûteux. **SSE** pour la progression (calquer sur big-sync : `Map<syncId,...>` + `text/event-stream`, cf. [src/pages/api/anime/big-sync.ts](../../src/pages/api/anime/big-sync.ts)). **Lock module-level** anti-concurrence (calquer sur `isHistoricalCrawlRunning` dans [src/lib/anime.ts:305](../../src/lib/anime.ts), renvoyer 409 si `alreadyRunning`).
- **`POST/DELETE /api/anime/recommendations/dismiss/[id]`** — ajoute/retire un id de `recommendations_dismissed.json` (calquer sur [src/pages/api/anime/animes/[id]/hide.ts](../../src/pages/api/anime/animes/[id]/hide.ts)).

### 7.3 Logique métier dans `src/lib/`
- **`src/lib/recommendations.ts`** (nouveau) : fetch (seeds → recos, suggestions, titres manquants, 2-hop optionnel), persistance `recommendations_MAL.json`, dismiss list, et le calcul du feed (ranking §5). Constantes de tuning ici.

### 7.4 Flux de fetch (refresh)
1. Auth check (401 sinon). Acquérir le lock (409 sinon).
2. Calculer les graines depuis `getAnimeForDisplay()` (`completed && score ≥ seuil`).
3. Pour chaque graine → `GET /v2/anime/{id}?fields=recommendations`. Stocker edges hop=1. **Délai entre appels** (250–500 ms, cf. délais existants 500–2000 ms dans anime.ts). Gérer **429** (backoff/retry).
4. Fetch `/v2/anime/suggestions`.
5. Si `nicheMode` : pour chaque candidat 1-hop, fetch `recommendations` → edges hop=2.
6. Dédup tous les recIds. Pour ceux absents du dataset → `GET /v2/anime/{id}?fields=<liste complète + my_list_status>` (réutiliser la liste de champs de `fetchSeasonalAnime`, cf. [src/lib/anime.ts:532](../../src/lib/anime.ts)) → `saveMALAnime`.
7. Écrire `recommendations_MAL.json` (lastRefresh, seedThreshold, nicheMode). Relâcher le lock.

> **Résumabilité** : un refresh = des centaines d'appels. Écrire les edges au fil de l'eau (pas seulement à la fin) pour qu'une interruption ne reparte pas de zéro. Au minimum, persister après l'étape graines avant d'attaquer les titres manquants.

### 7.5 Rendu (front)
- Nouveau preset **`for_you`** ajouté au type `AnimeView` ([src/models/anime/index.ts](../../src/models/anime/index.ts)) et aux **deux** listes de presets dupliquées (⚠️ `VIEW_PRESETS` existe dans [src/lib/animeUrlParams.ts](../../src/lib/animeUrlParams.ts) ET [src/lib/animeUtils.ts](../../src/lib/animeUtils.ts) — garder les deux cohérentes, voire factoriser).
- `index.tsx` : quand `view=for_you`, router vers `GET /api/anime/recommendations` au lieu de `/api/anime/animes`. Réutiliser `AnimeCardView` pour le rendu.

---

## 8. UI

- **Section sidebar "Recommandations"** (nouvelle, cf. pattern [src/components/anime/sidebar/DataSyncSection.tsx](../../src/components/anime/sidebar/DataSyncSection.tsx)) :
  - Bouton **"↻ Rafraîchir les recos"** + barre de progression SSE.
  - Contrôle du **seuil de note des graines** (défaut 8).
  - Toggle **"Mode niche (2-hop, plus lent)"**.
  - Date du dernier refresh.
  - Accès à la **vue "Écartés"**.
- **Preset "Pour toi"** dans `ViewsSection`.
- Sur chaque card de reco :
  - Action **"✕ écarter"** → POST dismiss (réversible).
  - Indice de match : *« recommandé par les fans de Steins;Gate · 312 »* (top graine(s) + backers depuis `recoMeta`), ou *« suggéré pour toi »* si `fromSuggestions`.
- **Vue "Écartés"** : liste des dismissed, calquée sur la vue `hidden`, avec action "remettre".
- Rappels CSS (cf. CLAUDE.md) : CSS Modules camelCase, **lancer `npm run css:types` après tout `.module.css`**, thème dark only, optimisé TV 4K / zoom 300%.

---

## 9. Ordre de construction suggéré (pour writing-plans)

1. **Lib + stockage** : `recommendations.ts` (types, lecture/écriture `recommendations_MAL.json` + dismiss), constantes de tuning.
2. **Fetch crowd-seed 1-hop** + insertion titres manquants + endpoint refresh SSE + lock. (MVP fetch.)
3. **Calcul du feed** : ranking §5 sans knobs avancés (juste affinité + filtres durs), endpoint `GET /recommendations`.
4. **Front** : preset `for_you`, routing index.tsx, section sidebar (bouton refresh + seuil), rendu cards + `recoMeta`.
5. **Dismiss** : endpoint + action card + vue "Écartés".
6. **Knobs ranking** : pénalité popularité, signal négatif, booster affinité.
7. **MAL suggestions** comme 2e source.
8. **Toggle mode niche 2-hop** (fetch hop=2 + damping λ).

---

## 10. Décisions verrouillées (récap)

| Décision | Choix |
|---|---|
| Type de reco | Feed "Pour toi" (preset dans la grille) |
| Moteur | Crowd MAL seedé |
| Graines | `completed && score ≥ 8`, **seuil paramétrable** |
| Titres manquants | **Fetch + insérer** (metadata complète) |
| Déjà-vu | Filtre dur completed/watching/on_hold/dropped ; **plan_to_watch autorisé** |
| Discard | **Liste dismiss séparée** (`recommendations_dismissed.json`), réversible |
| Refresh | **Bouton dédié** (SSE), pas dans big-sync |
| Profondeur | **1-hop + toggle "mode niche" 2-hop** (damping λ), stockage hop-aware |
| Niche | Pénalité popularité (d'office) + mode niche |
| Sources extra v1 | MAL suggestions (validé perso), signal négatif, booster affinité |
| SIMKL | Drop (synchro MAL) |
| AniList tags | Backlog / phase 2 |

---

## 11. Backlog / idées futures

- **Tags AniList** (GraphQL + mapping ID MAL↔AniList) : tags ultra-granulaires (« Time Loop », « Iyashikei »…) = meilleur levier découverte niche. Nouvelle intégration.
- Préférence de `source` (manga / light novel / original) comme signal de goût additionnel.
