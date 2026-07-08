// Client-safe rating grids. No fs/server deps — imported directly by the
// calculator component. Each grid is a list of sections; every criterion is
// scored on its `steps` (0..n) and the calculator normalizes the sum to /10.

export interface CriterionStep {
  value: number;
  /** Short one-word tier label shown on the button (e.g. "Cassé", "Maîtrisé"). */
  label: string;
  /** Longer explanation shown under the label. */
  description?: string;
  /** Concrete anime examples illustrating this tier. */
  examples?: string[];
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

// ── Grille "Complète" — anime terminé (juge l'œuvre finie), 5 niveaux ──
// 10 critères notés de 0 à 4 (label court + description + exemples concrets).
// Max 40 pts → 10/10 (chaque point = 0.25).
const COMPLETE_GRID: CriteriaSection[] = [
  {
    id: 'ecriture',
    name: "Écriture & Scénario",
    criteria: [
      {
        id: 'coherence_rythme',
        name: "Cohérence & Rythme",
        steps: [
          {
            value: 0,
            label: "Cassé",
            description: "Incohérences majeures, rythme brisé : longueurs, précipitation ou remplissage qui plombent le récit.",
            examples: ["Hellsing Ultimate (4) : structure d'OVA décousue, ça part dans tous les sens"],
          },
          {
            value: 1,
            label: "Bancal",
            description: "Ça tient debout mais ça patine ou trébuche par moments.",
            examples: ["Clannad (6) : longueurs et remplissage avant que ça décolle"],
          },
          {
            value: 2,
            label: "Correct",
            description: "Suivi sans accroc, rythme correct sans être remarquable.",
            examples: ["Dr. Stone (7) : ça se suit sans effort, sans relief particulier"],
          },
          {
            value: 3,
            label: "Bien tenu",
            description: "Rythme bien tenu sur la durée, peu de temps morts.",
            examples: ["Vinland Saga (8) : tempo maîtrisé malgré la lenteur assumée", "Jujutsu Kaisen (9)"],
          },
          {
            value: 4,
            label: "Maîtrisé",
            description: "Rythme maîtrisé de bout en bout, chaque épisode à sa place.",
            examples: ["Frieren: Beyond Journey's End (10) : chaque épisode pèse son poids", "Steins;Gate (10)"],
          },
        ],
      },
      {
        id: 'execution_originalite',
        name: "Exécution ou Originalité",
        steps: [
          {
            value: 0,
            label: "Paresseux",
            description: "Codes ressassés sans effort, ou bonne idée gâchée par l'exécution.",
            examples: ["The Hidden Dungeon Only I Can Enter (4) : moule isekai/ecchi sans relief"],
          },
          {
            value: 1,
            label: "Déjà-vu",
            description: "Du déjà-vu dans le fond comme la forme, exécution passable qui manque d'allant.",
            examples: ["My Happy Marriage (5) : codes du genre cochés sans allant"],
          },
          {
            value: 2,
            label: "Propre",
            description: "Codes classiques exécutés proprement, sans surprise.",
            examples: ["Blue Lock (6) : recette du sport-shônen exécutée proprement"],
          },
          {
            value: 3,
            label: "Une patte",
            description: "Une vraie patte d'auteur ou des idées qui sortent du lot.",
            examples: ["Bocchi the Rock! (9) : patte visuelle et comique qui sort du lot", "Dan Da Dan (10)"],
          },
          {
            value: 4,
            label: "Force le respect",
            description: "Concept réellement innovant, OU classique exécuté à un niveau qui force le respect.",
            examples: ["Steins;Gate (10) : concept temporel exploité à fond", "Ghost in the Shell (10, film 1995)"],
          },
        ],
      },
    ],
  },
  {
    id: 'personnages',
    name: "Les Personnages",
    criteria: [
      {
        id: 'evolution_ecriture',
        name: "Évolution & Écriture",
        steps: [
          {
            value: 0,
            label: "Plats",
            description: "Persos plats, motivations absentes ou incohérentes.",
            examples: ["Mistress Kanan is Devilishly Easy (4) : persos-fonction, zéro évolution"],
          },
          {
            value: 1,
            label: "Esquissés",
            description: "Motivations esquissées, psychologie sommaire.",
            examples: ["Campfire Cooking in Another World with My Absurd Skill (5) : motivations à peine posées"],
          },
          {
            value: 2,
            label: "Crédibles",
            description: "Motivations claires, psychologie crédible.",
            examples: ["Dr. Stone (7) : motivations lisibles, mais peu d'évolution"],
          },
          {
            value: 3,
            label: "Arcs amorcés",
            description: "Des arcs amorcés, quelques persos évoluent vraiment.",
            examples: ["86 Eighty-Six (8) : Shin et Lena avancent nettement"],
          },
          {
            value: 4,
            label: "Vrais arcs",
            description: "Vrais arcs, persos qui changent et le justifient.",
            examples: ["Vinland Saga (8) : Thorfinn, transformation gagnée", "Code Geass: Lelouch of the Rebellion R2 (9) : Lelouch"],
          },
        ],
      },
      {
        id: 'attachement_charisme',
        name: "Attachement / Charisme",
        steps: [
          {
            value: 0,
            label: "Indifférence",
            description: "Indifférence, voire rejet.",
            examples: ["Scum's Wish (4) : persos qui te laissent froid, voire agacent"],
          },
          {
            value: 1,
            label: "Tièdes",
            description: "Un ou deux persos sympas, le reste te laisse froid.",
            examples: ["Blue Lock (6) : un ou deux marquants, le reste fonctionnel"],
          },
          {
            value: 2,
            label: "Attachants",
            description: "On s'attache à quelques persos.",
            examples: ["Ranking of Kings (7) : on s'attache vite à Bojji"],
          },
          {
            value: 3,
            label: "Casting attachant",
            description: "Casting attachant, tu suis leurs histoires avec plaisir.",
            examples: ["Spy x Family (9) : la famille Forger", "Delicious in Dungeon (9)"],
          },
          {
            value: 4,
            label: "Magnétique",
            description: "Casting magnétique, leur sort te tient.",
            examples: ["Frieren: Beyond Journey's End (10)", "KonoSuba (10) : la bande de bras cassés"],
          },
        ],
      },
    ],
  },
  {
    id: 'realisation_visuelle',
    name: "Réalisation Visuelle",
    criteria: [
      {
        id: 'fluidite_dynamisme',
        name: "Fluidité & Dynamisme",
        steps: [
          {
            value: 0,
            label: "Figée",
            description: "Animation pauvre / figée qui nuit aux scènes clés.",
            examples: ["One-Punch Man Season 3 (1) : chute d'animation flagrante sur les combats"],
          },
          {
            value: 1,
            label: "Inégale",
            description: "Animation inégale, ça dépanne sans convaincre.",
            examples: ["Prod en dents de scie : beaux pics noyés dans du remplissage"],
          },
          {
            value: 2,
            label: "Propre",
            description: "Animation propre, au service de l'intention (baston, comédie, émotion).",
            examples: ["Dr. Stone (7) : anim propre au service du récit"],
          },
          {
            value: 3,
            label: "Soignée",
            description: "Animation soignée, quelques morceaux de bravoure.",
            examples: ["Jujutsu Kaisen (9) : gros épisodes-événements"],
          },
          {
            value: 4,
            label: "Transcende",
            description: "Animation qui transcende la scène, mémorable par elle-même.",
            examples: ["Chainsaw Man – The Movie: Reze Arc (10)", "Demon Slayer: Entertainment District Arc (10)"],
          },
        ],
      },
      {
        id: 'direction_artistique',
        name: "Direction Artistique",
        steps: [
          {
            value: 0,
            label: "Générique",
            description: "Visuel générique ou laid.",
            examples: ["The Hidden Dungeon Only I Can Enter (4) : DA passe-partout"],
          },
          {
            value: 1,
            label: "Sans identité",
            description: "Visuel banal mais propre, sans identité.",
            examples: ["My Happy Marriage (5) : propre mais anonyme"],
          },
          {
            value: 2,
            label: "Cohérente",
            description: "Identité visuelle correcte et cohérente.",
            examples: ["Blue Lock (6) : identité visuelle correcte et tenue"],
          },
          {
            value: 3,
            label: "Partis pris",
            description: "DA soignée avec de vrais partis pris.",
            examples: ["Made in Abyss (8) : direction visuelle forte", "Bakemonogatari (6) : partis pris Shaft assumés (note globale à part)"],
          },
          {
            value: 4,
            label: "Marquante",
            description: "DA marquante : couleurs, cadrage, mise en scène mémorables.",
            examples: ["Ghost in the Shell (10, film 1995)", "Witch Hat Atelier (7) : DA d'exception, le fond en retrait"],
          },
        ],
      },
    ],
  },
  {
    id: 'enrobage_sonore',
    name: "Enrobage Sonore",
    criteria: [
      {
        id: 'musique_ost',
        name: "Musique (OST, OP/ED)",
        steps: [
          {
            value: 0,
            label: "Oubliable",
            description: "BO oubliable ou hors-sujet, génériques qu'on skip.",
            examples: ["The Hidden Dungeon Only I Can Enter (4) : BO passe-partout, OP/ED skippés"],
          },
          {
            value: 1,
            label: "Fade",
            description: "BO fade, quelques pistes passent mais rien ne reste.",
            examples: ["My Happy Marriage (5) : BO fonctionnelle, rien ne reste"],
          },
          {
            value: 2,
            label: "Correcte",
            description: "BO correcte qui accompagne sans déranger.",
            examples: ["Dr. Stone (7) : soutient les scènes sans se faire remarquer"],
          },
          {
            value: 3,
            label: "Marquante",
            description: "Bonne BO, des thèmes qui marquent, génériques appréciés.",
            examples: ["Made in Abyss (8) : score de Kevin Penkin, thèmes forts"],
          },
          {
            value: 4,
            label: "No-skip",
            description: "BO qui magnifie les scènes, génériques no-skip.",
            examples: ["Frieren: Beyond Journey's End (10, Evan Call)", "A Silent Voice (10, Kensuke Ushio)"],
          },
        ],
      },
      {
        id: 'sound_design_doublage',
        name: "Sound Design & Doublage",
        steps: [
          {
            value: 0,
            label: "À côté",
            description: "Bruitages plats, doublage à côté.",
            examples: ["Impacts sans poids, seiyuu à contre-emploi (rarement un titre-repère net)"],
          },
          {
            value: 1,
            label: "Pauvre",
            description: "Sound design pauvre, doublage inégal.",
            examples: ["Design sonore minimal, jeu vocal en dents de scie"],
          },
          {
            value: 2,
            label: "Corrects",
            description: "Sound design et seiyuu corrects.",
            examples: ["Dr. Stone (7) : bruitages et casting vocal solides sans se distinguer"],
          },
          {
            value: 3,
            label: "Convaincant",
            description: "Bon sound design, doublage convaincant.",
            examples: ["Vinland Saga (8) : doublage investi, sound design solide"],
          },
          {
            value: 4,
            label: "Percutant",
            description: "Impacts / spatialisation percutants, doublage investi et juste.",
            examples: ["Chainsaw Man (9) : impacts et mixage qui claquent", "Demon Slayer: Entertainment District Arc (10)"],
          },
        ],
      },
    ],
  },
  {
    id: 'fin_impact',
    name: "Fin & Impact",
    criteria: [
      {
        id: 'gestion_conclusion',
        name: "Gestion de la Conclusion",
        steps: [
          {
            value: 0,
            label: "Bâclée",
            description: "Fin bâclée, expédiée ou inexistante.",
            examples: ["Fin anime-original expédiée / « lisez le manga » (pas d'exemple net dans ta liste)"],
          },
          {
            value: 1,
            label: "Demi-teinte",
            description: "Fin tiède ou en demi-teinte, laisse des trous.",
            examples: ["Bakemonogatari (6) : se clôt en demi-teinte, laisse des fils"],
          },
          {
            value: 2,
            label: "Propre",
            description: "Fin qui clôt proprement.",
            examples: ["Dr. Stone (7) : les arcs se referment correctement"],
          },
          {
            value: 3,
            label: "Satisfaisante",
            description: "Conclusion satisfaisante et cohérente.",
            examples: ["Vinland Saga Season 2 (8) : conclusion d'arc cohérente"],
          },
          {
            value: 4,
            label: "Empreinte",
            description: "Conclusion qui laisse une empreinte, à la hauteur du voyage.",
            examples: ["Steins;Gate (10)", "Fullmetal Alchemist: Brotherhood (10)"],
          },
        ],
      },
      {
        id: 'facteur_recommandation',
        name: "Facteur Recommandation",
        steps: [
          {
            value: 0,
            label: "À personne",
            description: "Tu le conseilles à personne / vu et oublié.",
            examples: ["One-Punch Man Season 3 (1)", "Alya Sometimes Hides Her Feelings in Russian (3)"],
          },
          {
            value: 1,
            label: "Bof",
            description: "Bof, tu n'en parles pas de toi-même.",
            examples: ["Scum's Wish (4)", "Natsume's Book of Friends (5)"],
          },
          {
            value: 2,
            label: "Sous conditions",
            description: "Tu le conseilles sous conditions (public précis).",
            examples: ["Blue Lock (6) : pour les amateurs du genre", "One-Punch Man (6)"],
          },
          {
            value: 3,
            label: "Volontiers",
            description: "Tu le recommandes volontiers.",
            examples: ["Made in Abyss (8)", "Vinland Saga (8)"],
          },
          {
            value: 4,
            label: "Spontanément",
            description: "Tu le recommandes spontanément / envie de le revoir.",
            examples: ["Asobi Asobase (10) : ton rewatch annuel", "Frieren: Beyond Journey's End (10)"],
          },
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

export const RATING_GRIDS: RatingGrid[] = [
  {
    id: 'complete',
    name: 'Complète',
    description: "Anime terminé — juge l'œuvre finie.",
    sections: COMPLETE_GRID,
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
