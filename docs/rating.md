[
  {
    id: 'ecriture',
    name: 'Écriture & Scénario',
    criteria: [
      {
        id: 'coherence_rythme',
        name: 'Cohérence & Rythme',
        steps: [
          {
            value: 0,
            label: "Cassé",
            description: "Incohérences majeures, rythme brisé : longueurs, précipitation ou remplissage qui plombent le récit.",
            examples: [
              "Adaptation qui compresse plusieurs tomes en un épisode pour boucler à la va-vite",
              "The Promised Neverland S2, arcs entiers sautés",
            ],
          },
          {
            value: 1,
            label: "Bancal",
            description: "Ça tient debout mais ça patine ou trébuche par moments.",
            examples: [
              "Arcs de filler qui cassent l'élan (longs passages de Bleach / Naruto)",
              "Ventre mou de milieu de saison avant que ça reparte",
            ],
          },
          {
            value: 2,
            label: "Correct",
            description: "Suivi sans accroc, rythme correct sans être remarquable.",
            examples: [
              "Shônen saisonnier qui se suit sans effort mais sans relief",
            ],
          },
          {
            value: 3,
            label: "Bien tenu",
            description: "Rythme bien tenu sur la durée, peu de temps morts.",
            examples: [
              "Vinland Saga S1",
              "Jujutsu Kaisen S1, peu de gras",
            ],
          },
          {
            value: 4,
            label: "Maîtrisé",
            description: "Rythme maîtrisé de bout en bout, chaque épisode à sa place.",
            examples: [
              "Frieren : chaque épisode pèse son poids",
              "Monster, dense malgré 74 épisodes ; Steins;Gate",
            ],
          },
        ],
      },
      {
        id: 'execution_originalite',
        name: 'Exécution ou Originalité',
        steps: [
          {
            value: 0,
            label: "Paresseux",
            description: "Codes ressassés sans effort, ou bonne idée de départ gâchée par l'exécution.",
            examples: [
              "Isekai power-fantasy au moule, héros OP sans enjeu",
            ],
          },
          {
            value: 1,
            label: "Déjà-vu",
            description: "Du déjà-vu dans le fond comme la forme, exécution passable qui manque d'allant.",
            examples: [
              "Romcom scolaire qui coche les cases sans énergie",
            ],
          },
          {
            value: 2,
            label: "Propre",
            description: "Codes classiques exécutés proprement, sans surprise.",
            examples: [
              "Battle shônen classique bien mené mais balisé",
            ],
          },
          {
            value: 3,
            label: "Une patte",
            description: "Une vraie patte d'auteur ou des idées qui sortent du lot.",
            examples: [
              "Dandadan, ton et énergie qui sortent du lot",
              "Odd Taxi, angle narratif original",
            ],
          },
          {
            value: 4,
            label: "Force le respect",
            description: "Concept réellement innovant, OU classique exécuté à un niveau qui force le respect.",
            examples: [
              "Steins;Gate : concept temporel exploité à fond",
              "Ghost in the Shell (film) ; Frieren, le classique sublimé",
            ],
          },
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
          {
            value: 0,
            label: "Plats",
            description: "Persos plats, motivations absentes ou incohérentes.",
            examples: [
              "Faire-valoir sans motivation, méchant méchant « parce que »",
            ],
          },
          {
            value: 1,
            label: "Esquissés",
            description: "Motivations esquissées, psychologie sommaire.",
            examples: [
              "Motivations posées en une réplique, jamais creusées",
            ],
          },
          {
            value: 2,
            label: "Crédibles",
            description: "Motivations claires, psychologie crédible.",
            examples: [
              "Casting cohérent dont les choix se comprennent",
            ],
          },
          {
            value: 3,
            label: "Arcs amorcés",
            description: "Des arcs amorcés, quelques persos évoluent vraiment.",
            examples: [
              "Deux-trois persos qui évoluent nettement sur la saison",
            ],
          },
          {
            value: 4,
            label: "Vrais arcs",
            description: "Vrais arcs, persos qui changent et le justifient.",
            examples: [
              "Thorfinn (Vinland Saga), transformation gagnée",
              "Johan / Tenma (Monster) ; Rei (March Comes in Like a Lion)",
            ],
          },
        ],
      },
      {
        id: 'attachement_charisme',
        name: 'Attachement / Charisme',
        steps: [
          {
            value: 0,
            label: "Indifférence",
            description: "Indifférence, voire rejet.",
            examples: [
              "Tu ne retiens aucun nom à la fin",
            ],
          },
          {
            value: 1,
            label: "Tièdes",
            description: "Un ou deux persos sympas, le reste te laisse froid.",
            examples: [
              "Un sidekick sympa, le reste transparent",
            ],
          },
          {
            value: 2,
            label: "Attachants",
            description: "On s'attache à quelques persos.",
            examples: [
              "Deux-trois persos auxquels tu tiens",
            ],
          },
          {
            value: 3,
            label: "Casting attachant",
            description: "Casting attachant, tu suis leurs histoires avec plaisir.",
            examples: [
              "Bande dont tu suis chaque histoire avec plaisir (Spy x Family)",
            ],
          },
          {
            value: 4,
            label: "Magnétique",
            description: "Casting magnétique, leur sort te tient.",
            examples: [
              "Frieren & compagnie ; l'équipage du Bebop, dont le sort te tient",
            ],
          },
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
          {
            value: 0,
            label: "Figée",
            description: "Animation pauvre / figée qui nuit aux scènes clés.",
            examples: [
              "Plans fixes et économies de budget qui plombent les moments forts",
            ],
          },
          {
            value: 1,
            label: "Inégale",
            description: "Animation inégale, ça dépanne sans convaincre.",
            examples: [
              "Beaux key frames mais intervalles pauvres",
            ],
          },
          {
            value: 2,
            label: "Propre",
            description: "Animation propre, au service de l'intention (baston, comédie, émotion).",
            examples: [
              "Animation nette au service de la scène, sans esbroufe",
            ],
          },
          {
            value: 3,
            label: "Soignée",
            description: "Animation soignée, quelques morceaux de bravoure.",
            examples: [
              "Gros épisodes-événements bien au-dessus de la moyenne de la série",
            ],
          },
          {
            value: 4,
            label: "Transcende",
            description: "Animation qui transcende la scène, mémorable par elle-même.",
            examples: [
              "Sakuga qui devient la scène (Demon Slayer / Ufotable)",
              "Mob Psycho 100 ; Chainsaw Man",
            ],
          },
        ],
      },
      {
        id: 'direction_artistique',
        name: 'Direction Artistique',
        steps: [
          {
            value: 0,
            label: "Générique",
            description: "Visuel générique ou laid.",
            examples: [
              "Chara-design interchangeable, décors sans âme",
            ],
          },
          {
            value: 1,
            label: "Sans identité",
            description: "Visuel banal mais propre, sans identité.",
            examples: [
              "Propre mais anonyme, aucun parti pris",
            ],
          },
          {
            value: 2,
            label: "Cohérente",
            description: "Identité visuelle correcte et cohérente.",
            examples: [
              "Direction visuelle correcte et tenue sur la durée",
            ],
          },
          {
            value: 3,
            label: "Partis pris",
            description: "DA soignée avec de vrais partis pris.",
            examples: [
              "Palette et cadrage affirmés (Made in Abyss)",
            ],
          },
          {
            value: 4,
            label: "Marquante",
            description: "DA marquante : couleurs, cadrage, mise en scène mémorables.",
            examples: [
              "Ping Pong (Yuasa), mise en scène signature",
              "Utena / Penguindrum (Ikuhara) ; GITS (film)",
            ],
          },
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
          {
            value: 0,
            label: "Oubliable",
            description: "BO oubliable ou hors-sujet, génériques qu'on skip.",
            examples: [
              "OST passe-partout, OP/ED skippés direct",
            ],
          },
          {
            value: 1,
            label: "Fade",
            description: "BO fade, quelques pistes passent mais rien ne reste.",
            examples: [
              "Une ou deux pistes correctes, rien ne marque",
            ],
          },
          {
            value: 2,
            label: "Correcte",
            description: "BO correcte qui accompagne sans déranger.",
            examples: [
              "OST fonctionnelle qui soutient les scènes sans se faire remarquer",
            ],
          },
          {
            value: 3,
            label: "Marquante",
            description: "Bonne BO, des thèmes qui marquent, génériques appréciés.",
            examples: [
              "Des thèmes identifiables, OP/ED qu'on garde",
            ],
          },
          {
            value: 4,
            label: "No-skip",
            description: "BO qui magnifie les scènes, génériques no-skip.",
            examples: [
              "Sawano (Attack on Titan) ; Yoko Kanno (Bebop)",
              "Ushio (Ping Pong, A Silent Voice) ; Evan Call (Frieren)",
            ],
          },
        ],
      },
      {
        id: 'sound_design_doublage',
        name: 'Sound Design & Doublage',
        steps: [
          {
            value: 0,
            label: "À côté",
            description: "Bruitages plats, doublage à côté.",
            examples: [
              "Impacts sans poids, seiyuu à contre-emploi",
            ],
          },
          {
            value: 1,
            label: "Pauvre",
            description: "Sound design pauvre, doublage inégal.",
            examples: [
              "Design sonore minimal, jeu vocal en dents de scie",
            ],
          },
          {
            value: 2,
            label: "Corrects",
            description: "Sound design et seiyuu corrects.",
            examples: [
              "Bruitages et casting vocal solides sans se distinguer",
            ],
          },
          {
            value: 3,
            label: "Convaincant",
            description: "Bon sound design, doublage convaincant.",
            examples: [
              "Design sonore soigné, seiyuu investis",
            ],
          },
          {
            value: 4,
            label: "Percutant",
            description: "Impacts / spatialisation percutants, doublage investi et juste.",
            examples: [
              "Impacts et mixage qui claquent, seiyuu au sommet",
            ],
          },
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
          {
            value: 0,
            label: "Bâclée",
            description: "Fin bâclée, expédiée ou inexistante.",
            examples: [
              "Fin anime-original expédiée, ou « lisez le manga »",
            ],
          },
          {
            value: 1,
            label: "Demi-teinte",
            description: "Fin tiède ou en demi-teinte, laisse des trous.",
            examples: [
              "Conclusion tiède qui laisse des fils pendants",
            ],
          },
          {
            value: 2,
            label: "Propre",
            description: "Fin qui clôt proprement.",
            examples: [
              "Ça referme correctement, sans éclat",
            ],
          },
          {
            value: 3,
            label: "Satisfaisante",
            description: "Conclusion satisfaisante et cohérente.",
            examples: [
              "Résolution cohérente qui paie ce qui a été posé",
            ],
          },
          {
            value: 4,
            label: "Empreinte",
            description: "Conclusion qui laisse une empreinte, à la hauteur du voyage.",
            examples: [
              "Steins;Gate ; Cowboy Bebop, fin à la hauteur du voyage",
            ],
          },
        ],
      },
      {
        id: 'facteur_recommandation',
        name: 'Facteur Recommandation',
        steps: [
          {
            value: 0,
            label: "À personne",
            description: "Tu le conseilles à personne / vu et oublié.",
            examples: [
              "Vu et oublié, tu n'en parles pas",
            ],
          },
          {
            value: 1,
            label: "Bof",
            description: "Bof, tu n'en parles pas de toi-même.",
            examples: [
              "Tu ne le sors pas spontanément",
            ],
          },
          {
            value: 2,
            label: "Sous conditions",
            description: "Tu le conseilles sous conditions (public précis).",
            examples: [
              "Recommandé aux fans du genre uniquement",
            ],
          },
          {
            value: 3,
            label: "Volontiers",
            description: "Tu le recommandes volontiers.",
            examples: [
              "Tu le conseilles sans hésiter quand le sujet vient",
            ],
          },
          {
            value: 4,
            label: "Spontanément",
            description: "Tu le recommandes spontanément / envie de le revoir.",
            examples: [
              "Tu le cites de toi-même, envie de le revoir (Asobi Asobase, ton rewatch annuel)",
            ],
          },
        ],
      },
    ],
  },
]