// Client-safe rating grids. No fs/server deps — imported directly by the
// calculator component. Each grid is a list of sections; every criterion is
// scored on its `steps` (0..n) and the calculator normalizes the sum to /10.

export interface CriterionStep {
  value: number;
  label: string;
}

export interface Criterion {
  id: string;
  name: string;
  steps: CriterionStep[];
}

export interface CriteriaSection {
  id: string;
  name: string;
  criteria: Criterion[];
}

export interface RatingGrid {
  id: string;
  /** Shown in the grid dropdown. */
  name: string;
  /** Optional one-line context under the dropdown. */
  description?: string;
  sections: CriteriaSection[];
  /**
   * Point total that maps to 10.0/10. Defaults to the grid's own max (so a
   * fully-marked grid = 10). Set it ABOVE the achievable max to make a grid
   * top out lower by design — e.g. the "dropped" grid references the 20-pt
   * complete scale, so its 14-pt max lands at 7.0 rather than 10.
   */
  pointsForTen?: number;
}

// ── Grille "Complète" — pour un anime terminé (juge l'œuvre finie) ──
const COMPLETE_GRID: CriteriaSection[] = [
  {
    id: 'ecriture',
    name: 'Écriture & Scénario',
    criteria: [
      {
        id: 'coherence_rythme',
        name: 'Cohérence & Rythme',
        steps: [
          { value: 0, label: "Incohérences majeures ou rythme cassé (longueurs, rush, remplissage)" },
          { value: 1, label: "Suivi sans accroc, rythme correct" },
          { value: 2, label: "Rythme maîtrisé de bout en bout" },
        ],
      },
      {
        id: 'execution_originalite',
        name: 'Exécution ou Originalité',
        steps: [
          { value: 0, label: "Codes ressassés avec paresse, ou bonne idée gâchée" },
          { value: 1, label: "Codes classiques exécutés proprement, sans surprise" },
          { value: 2, label: "Concept innovant OU classique exécuté à un niveau qui force le respect" },
        ],
      },
    ],
  },
  {
    id: 'personnages',
    name: 'Les Personnages',
    criteria: [
      {
        id: 'evolution_ecriture',
        name: 'Évolution & Écriture',
        steps: [
          { value: 0, label: "Persos plats, motivations absentes ou incohérentes" },
          { value: 1, label: "Motivations claires, psychologie crédible" },
          { value: 2, label: "Vrais arcs, persos qui changent et le justifient" },
        ],
      },
      {
        id: 'attachement_charisme',
        name: 'Attachement / Charisme',
        steps: [
          { value: 0, label: "Indifférence, voire rejet" },
          { value: 1, label: "On s'attache à quelques persos" },
          { value: 2, label: "Casting magnétique, leur sort te tient" },
        ],
      },
    ],
  },
  {
    id: 'realisation_visuelle',
    name: 'Réalisation Visuelle',
    criteria: [
      {
        id: 'fluidite_dynamisme',
        name: 'Fluidité & Dynamisme',
        steps: [
          { value: 0, label: "Animation pauvre/figée qui nuit aux scènes clés" },
          { value: 1, label: "Animation propre, au service de l'intention (baston, comédie ou émotion)" },
          { value: 2, label: "Animation qui transcende la scène, mémorable par elle-même" },
        ],
      },
      {
        id: 'direction_artistique',
        name: 'Direction Artistique',
        steps: [
          { value: 0, label: "Visuel générique ou laid" },
          { value: 1, label: "Identité visuelle correcte et cohérente" },
          { value: 2, label: "DA marquante (couleurs, cadrage, mise en scène mémorables)" },
        ],
      },
    ],
  },
  {
    id: 'enrobage_sonore',
    name: 'Enrobage Sonore',
    criteria: [
      {
        id: 'musique_ost',
        name: 'Musique (OST, OP/ED)',
        steps: [
          { value: 0, label: "BO oubliable ou hors-sujet, génériques qu'on skip" },
          { value: 1, label: "BO correcte qui accompagne sans déranger" },
          { value: 2, label: "BO qui magnifie les scènes, génériques no-skip" },
        ],
      },
      {
        id: 'sound_design_doublage',
        name: 'Sound Design & Doublage',
        steps: [
          { value: 0, label: "Bruitages plats, doublage à côté" },
          { value: 1, label: "Sound design et seiyuu corrects" },
          { value: 2, label: "Impacts/spatialisation percutants, doublage investi et juste" },
        ],
      },
    ],
  },
  {
    id: 'fin_impact',
    name: 'Fin & Impact',
    criteria: [
      {
        id: 'gestion_conclusion',
        name: 'Gestion de la Conclusion',
        steps: [
          { value: 0, label: "Fin bâclée, expédiée ou inexistante" },
          { value: 1, label: "Fin qui clôt proprement" },
          { value: 2, label: "Conclusion satisfaisante et logique qui laisse une empreinte" },
        ],
      },
      {
        id: 'facteur_recommandation',
        name: 'Facteur Recommandation',
        steps: [
          { value: 0, label: "Tu le conseilles à personne / vu et oublié" },
          { value: 1, label: "Tu le conseilles sous conditions (public précis)" },
          { value: 2, label: "Tu le recommandes spontanément / envie de le revoir" },
        ],
      },
    ],
  },
];

// ── Grille "Droppée" — pour un anime lâché au bout de quelques épisodes ──
// On ne juge pas l'œuvre finie (impossible), mais la QUALITÉ de l'échantillon
// vu, nuancée par la RAISON du drop. Calibrée pour rester basse : un "c'est
// nul" tombe ~2-3, un "propre mais générique" ~4-5, un "bon mais pas pour moi /
// à retenter" peut remonter ~5-6. Le critère "raison du drop" est volontairement
// contre-intuitif : plus la faute revient au contexte/à toi plutôt qu'à l'œuvre,
// plus il rapporte de points.
const DROPPED_GRID: CriteriaSection[] = [
  {
    id: 'accroche',
    name: "L'Accroche",
    criteria: [
      {
        id: 'concept_pitch',
        name: 'Concept / Pitch',
        steps: [
          { value: 0, label: "Rebutant ou vu mille fois, aucune envie" },
          { value: 1, label: "Correct mais tiède, ça ne vend pas" },
          { value: 2, label: "Prémisse intrigante, ça donnait envie sur le papier" },
        ],
      },
      {
        id: 'demarrage',
        name: 'Le Démarrage (ép. 1)',
        steps: [
          { value: 0, label: "M'a perdu tout de suite" },
          { value: 1, label: "Neutre, ni chaud ni froid" },
          { value: 2, label: "M'a accroché… avant que ça retombe" },
        ],
      },
    ],
  },
  {
    id: 'execution_vue',
    name: 'Exécution Vue',
    criteria: [
      {
        id: 'realisation_animation',
        name: 'Réalisation & Animation',
        steps: [
          { value: 0, label: "Fauchée / laide, ça pique" },
          { value: 1, label: "Propre, fonctionnelle" },
          { value: 2, label: "Soignée, du cachet malgré le drop" },
        ],
      },
      {
        id: 'ecriture_immediate',
        name: 'Écriture Immédiate',
        steps: [
          { value: 0, label: "Maladroite, expo lourde, dialogues plats" },
          { value: 1, label: "Fonctionnelle, sans plus" },
          { value: 2, label: "Vive, bien amenée, mise en place efficace" },
        ],
      },
    ],
  },
  {
    id: 'personnages_impression',
    name: 'Personnages (1re impression)',
    criteria: [
      {
        id: 'attachement_antipathie',
        name: 'Attachement / Antipathie',
        steps: [
          { value: 0, label: "Rejet ou agacement actif" },
          { value: 1, label: "Indifférence totale" },
          { value: 2, label: "Une lueur, un perso qui sortait du lot" },
        ],
      },
    ],
  },
  {
    id: 'le_drop',
    name: 'Le Drop',
    criteria: [
      {
        id: 'raison_drop',
        name: 'Raison Principale',
        steps: [
          { value: 0, label: "Fondamentalement mauvais (l'œuvre est en cause)" },
          { value: 1, label: "Générique, lent ou ennuyeux (correct mais sans intérêt)" },
          { value: 2, label: "Pas pour moi ou mauvais moment (l'œuvre n'est pas en cause)" },
        ],
      },
      {
        id: 'verdict',
        name: 'Verdict',
        steps: [
          { value: 0, label: "Sûr que ça ne vaut pas le coup, jamais je reprends" },
          { value: 1, label: "Mitigé, peut-être un jour" },
          { value: 2, label: "À retenter, sur bon conseil ça pourrait le faire" },
        ],
      },
    ],
  },
];

// ── Grille "Complète V2" — même œuvre finie, 5 niveaux par critère ──
// Mêmes 10 critères que COMPLETE_GRID, mais chaque critère va de 0 à 4 pour une
// notation plus fine. Les ancres 0/1/2 d'origine deviennent 0/2/4 ; les niveaux
// 1 (en dessous) et 3 (au-dessus) sont interpolés. Échelle : 0 raté · 1 faible ·
// 2 correct · 3 solide · 4 exceptionnel. Max 40 pts → 10/10 (chaque point = 0.25).
const COMPLETE_V2_GRID: CriteriaSection[] = [
  {
    id: 'ecriture',
    name: 'Écriture & Scénario',
    criteria: [
      {
        id: 'coherence_rythme',
        name: 'Cohérence & Rythme',
        steps: [
          { value: 0, label: "Incohérences majeures, rythme cassé (longueurs, rush, remplissage)" },
          { value: 1, label: "Ça tient debout mais ça patine ou trébuche par moments" },
          { value: 2, label: "Suivi sans accroc, rythme correct" },
          { value: 3, label: "Rythme bien tenu, peu de temps morts" },
          { value: 4, label: "Rythme maîtrisé de bout en bout, chaque épisode à sa place" },
        ],
      },
      {
        id: 'execution_originalite',
        name: 'Exécution ou Originalité',
        steps: [
          { value: 0, label: "Codes ressassés avec paresse, ou bonne idée gâchée" },
          { value: 1, label: "Du déjà-vu, exécution passable qui manque d'allant" },
          { value: 2, label: "Codes classiques exécutés proprement, sans surprise" },
          { value: 3, label: "Une vraie patte ou des idées qui sortent du lot" },
          { value: 4, label: "Concept innovant OU classique exécuté à un niveau qui force le respect" },
        ],
      },
    ],
  },
  {
    id: 'personnages',
    name: 'Les Personnages',
    criteria: [
      {
        id: 'evolution_ecriture',
        name: 'Évolution & Écriture',
        steps: [
          { value: 0, label: "Persos plats, motivations absentes ou incohérentes" },
          { value: 1, label: "Motivations esquissées, psychologie sommaire" },
          { value: 2, label: "Motivations claires, psychologie crédible" },
          { value: 3, label: "Des arcs amorcés, quelques persos évoluent vraiment" },
          { value: 4, label: "Vrais arcs, persos qui changent et le justifient" },
        ],
      },
      {
        id: 'attachement_charisme',
        name: 'Attachement / Charisme',
        steps: [
          { value: 0, label: "Indifférence, voire rejet" },
          { value: 1, label: "Un ou deux persos sympas, le reste te laisse froid" },
          { value: 2, label: "On s'attache à quelques persos" },
          { value: 3, label: "Casting attachant, tu suis leurs histoires avec plaisir" },
          { value: 4, label: "Casting magnétique, leur sort te tient" },
        ],
      },
    ],
  },
  {
    id: 'realisation_visuelle',
    name: 'Réalisation Visuelle',
    criteria: [
      {
        id: 'fluidite_dynamisme',
        name: 'Fluidité & Dynamisme',
        steps: [
          { value: 0, label: "Animation pauvre/figée qui nuit aux scènes clés" },
          { value: 1, label: "Animation inégale, ça dépanne sans convaincre" },
          { value: 2, label: "Animation propre, au service de l'intention (baston, comédie, émotion)" },
          { value: 3, label: "Animation soignée, quelques morceaux de bravoure" },
          { value: 4, label: "Animation qui transcende la scène, mémorable par elle-même" },
        ],
      },
      {
        id: 'direction_artistique',
        name: 'Direction Artistique',
        steps: [
          { value: 0, label: "Visuel générique ou laid" },
          { value: 1, label: "Visuel banal mais propre, sans identité" },
          { value: 2, label: "Identité visuelle correcte et cohérente" },
          { value: 3, label: "DA soignée avec de vrais partis pris" },
          { value: 4, label: "DA marquante (couleurs, cadrage, mise en scène mémorables)" },
        ],
      },
    ],
  },
  {
    id: 'enrobage_sonore',
    name: 'Enrobage Sonore',
    criteria: [
      {
        id: 'musique_ost',
        name: 'Musique (OST, OP/ED)',
        steps: [
          { value: 0, label: "BO oubliable ou hors-sujet, génériques qu'on skip" },
          { value: 1, label: "BO fade, quelques pistes passent mais rien ne reste" },
          { value: 2, label: "BO correcte qui accompagne sans déranger" },
          { value: 3, label: "Bonne BO, des thèmes qui marquent, génériques appréciés" },
          { value: 4, label: "BO qui magnifie les scènes, génériques no-skip" },
        ],
      },
      {
        id: 'sound_design_doublage',
        name: 'Sound Design & Doublage',
        steps: [
          { value: 0, label: "Bruitages plats, doublage à côté" },
          { value: 1, label: "Sound design pauvre, doublage inégal" },
          { value: 2, label: "Sound design et seiyuu corrects" },
          { value: 3, label: "Bon sound design, doublage convaincant" },
          { value: 4, label: "Impacts/spatialisation percutants, doublage investi et juste" },
        ],
      },
    ],
  },
  {
    id: 'fin_impact',
    name: 'Fin & Impact',
    criteria: [
      {
        id: 'gestion_conclusion',
        name: 'Gestion de la Conclusion',
        steps: [
          { value: 0, label: "Fin bâclée, expédiée ou inexistante" },
          { value: 1, label: "Fin tiède ou en demi-teinte, laisse des trous" },
          { value: 2, label: "Fin qui clôt proprement" },
          { value: 3, label: "Conclusion satisfaisante et cohérente" },
          { value: 4, label: "Conclusion qui laisse une empreinte, à la hauteur du voyage" },
        ],
      },
      {
        id: 'facteur_recommandation',
        name: 'Facteur Recommandation',
        steps: [
          { value: 0, label: "Tu le conseilles à personne / vu et oublié" },
          { value: 1, label: "Bof, tu n'en parles pas de toi-même" },
          { value: 2, label: "Tu le conseilles sous conditions (public précis)" },
          { value: 3, label: "Tu le recommandes volontiers" },
          { value: 4, label: "Tu le recommandes spontanément / envie de le revoir" },
        ],
      },
    ],
  },
];

export const RATING_GRIDS: RatingGrid[] = [
  {
    id: 'complete',
    name: 'Complète',
    description: "Anime terminé — juge l'œuvre finie.",
    sections: COMPLETE_GRID,
  },
  {
    id: 'complete-v2',
    name: 'Complète V2',
    description: "Anime terminé, notation fine — 5 niveaux par critère.",
    sections: COMPLETE_V2_GRID,
  },
  {
    id: 'dropped',
    name: 'Droppée',
    description: "Anime lâché après quelques épisodes — juge l'échantillon vu + la raison du drop.",
    sections: DROPPED_GRID,
    // 14-pt max scored against the 20-pt complete scale → tops out at 7.0/10.
    // A drop stays capped low by design without a hard clamp; each point = 0.5.
    pointsForTen: 20,
  },
];

export const DEFAULT_GRID_ID = RATING_GRIDS[0].id;

export function getGrid(id: string): RatingGrid {
  return RATING_GRIDS.find(g => g.id === id) ?? RATING_GRIDS[0];
}
