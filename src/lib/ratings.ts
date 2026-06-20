import fs from 'fs';
import path from 'path';
import { CriteriaSection, SavedRating } from '@/models/rating';

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const RATINGS_FILE = path.join(DATA_PATH, 'ratings.json');
const CRITERIA_FILE = path.join(DATA_PATH, 'rating_criteria.json');

const DEFAULT_CRITERIA: CriteriaSection[] = [
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

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  ensureDataDirectory();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getRatingCriteria(): CriteriaSection[] {
  return readJsonFile<CriteriaSection[]>(CRITERIA_FILE, DEFAULT_CRITERIA);
}

export function seedCriteriaIfAbsent(): void {
  if (!fs.existsSync(CRITERIA_FILE)) {
    writeJsonFile(CRITERIA_FILE, DEFAULT_CRITERIA);
  }
}

export function getAllRatings(): SavedRating[] {
  return readJsonFile<SavedRating[]>(RATINGS_FILE, []);
}

export function saveRating(rating: Omit<SavedRating, 'id' | 'savedAt'>): SavedRating {
  const ratings = getAllRatings();
  const newRating: SavedRating = {
    ...rating,
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
  };
  ratings.unshift(newRating);
  writeJsonFile(RATINGS_FILE, ratings);
  return newRating;
}

export function deleteRating(id: string): boolean {
  const ratings = getAllRatings();
  const filtered = ratings.filter(r => r.id !== id);
  if (filtered.length === ratings.length) return false;
  writeJsonFile(RATINGS_FILE, filtered);
  return true;
}
