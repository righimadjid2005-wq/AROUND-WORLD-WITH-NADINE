/**
 * src/levels.js
 * Modular 10-World / 50-Level Cooperative Campaign & Expandable Pack Registry
 * for "Around the World with Nadine".
 *
 * Future level packs can be appended cleanly at runtime via registerWorldPack()
 * without modifying physics, rendering, skins, audio, or background code.
 */

export const STORY_PREMISE =
  'Madjid and Nadine had grown tired of the quiet routine of their small village. One morning, Madjid confessed his love and asked if she would travel around the world with him before their wedding—and Nadine gladly said yes.';

export const WORLDS = [
  {
    id: 1,
    name: 'Quiet Village Outskirts',
    subtitle: 'Where a promise begins at dawn',
    theme: 'sunrise',
    landmark: 'cottages',
    ambient: 'petals',
    enemyKind: 'beetle',
    hazardKind: 'thorns',
    accentColor: '#76A665',
    platformPalette: {
      top: '#76A665',
      topRim: '#9FD184',
      body: '#463E54',
      trim: '#2A2438',
    },
    stageThemes: ['sunrise', 'sunrise', 'sunrise', 'sunrise', 'sunrise'],
  },
  {
    id: 2,
    name: 'Golden Meadows',
    subtitle: 'Turning windmills and sunlit valleys',
    theme: 'sunrise',
    landmark: 'windmills',
    ambient: 'dandelions',
    enemyKind: 'beetle',
    hazardKind: 'thorns',
    accentColor: '#98C462',
    platformPalette: {
      top: '#86B65C',
      topRim: '#B5DF80',
      body: '#4C4157',
      trim: '#2B2336',
    },
    stageThemes: ['sunrise', 'sunrise', 'sunrise', 'sunrise', 'sunset'],
  },
  {
    id: 3,
    name: 'Lantern Harbor',
    subtitle: 'Glowing piers and gentle sea breezes',
    theme: 'sunset',
    landmark: 'lighthouse',
    ambient: 'fireflies',
    enemyKind: 'crab',
    hazardKind: 'spikes',
    accentColor: '#E59A62',
    platformPalette: {
      top: '#C98456',
      topRim: '#ECA978',
      body: '#362D4C',
      trim: '#1E182E',
    },
    stageThemes: ['sunset', 'sunset', 'sunset', 'sunset', 'night'],
  },
  {
    id: 4,
    name: 'Sunset Cliffs',
    subtitle: 'Ancient stone arches above warm canyons',
    theme: 'sunset',
    landmark: 'aqueduct',
    ambient: 'dandelions',
    enemyKind: 'beetle',
    hazardKind: 'spikes',
    accentColor: '#E68364',
    platformPalette: {
      top: '#D47E5B',
      topRim: '#F2A987',
      body: '#402C49',
      trim: '#24172D',
    },
    stageThemes: ['sunset', 'sunset', 'sunset', 'sunset', 'night'],
  },
  {
    id: 5,
    name: 'Starry Desert',
    subtitle: 'Crescent moon over quiet golden dunes',
    theme: 'night',
    landmark: 'dunes',
    ambient: 'fireflies',
    enemyKind: 'beetle',
    hazardKind: 'thorns',
    accentColor: '#DFC287',
    platformPalette: {
      top: '#B8985D',
      topRim: '#E2C58A',
      body: '#22294A',
      trim: '#131830',
    },
    stageThemes: ['night', 'night', 'night', 'night', 'night'],
  },
  {
    id: 6,
    name: 'Misty Highlands',
    subtitle: 'Crisp pine ridges greeting the morning',
    theme: 'sunrise',
    landmark: 'peaks',
    ambient: 'petals',
    enemyKind: 'wisp',
    hazardKind: 'spikes',
    accentColor: '#6EA884',
    platformPalette: {
      top: '#639A78',
      topRim: '#8FC4A2',
      body: '#3B415A',
      trim: '#212538',
    },
    stageThemes: ['sunrise', 'sunrise', 'sunrise', 'sunrise', 'sunset'],
  },
  {
    id: 7,
    name: 'Cloud Bridges',
    subtitle: 'Floating pavilions painted by dusk',
    theme: 'sunset',
    landmark: 'pagodas',
    ambient: 'petals',
    enemyKind: 'wisp',
    hazardKind: 'crystals',
    accentColor: '#E79CAE',
    platformPalette: {
      top: '#D48697',
      topRim: '#F6B8C6',
      body: '#393054',
      trim: '#201A34',
    },
    stageThemes: ['sunset', 'sunset', 'sunset', 'sunset', 'night'],
  },
  {
    id: 8,
    name: 'Crystal Caverns',
    subtitle: 'Luminous geodes humming in calm night',
    theme: 'night',
    landmark: 'crystals',
    ambient: 'fireflies',
    enemyKind: 'wisp',
    hazardKind: 'crystals',
    accentColor: '#69B8BF',
    platformPalette: {
      top: '#4A8E96',
      topRim: '#7CC4CB',
      body: '#1D2742',
      trim: '#10172A',
    },
    stageThemes: ['night', 'night', 'night', 'night', 'night'],
  },
  {
    id: 9,
    name: 'Moonlit Gardens',
    subtitle: 'Fragrant gazebos lit by warm fireflies',
    theme: 'night',
    landmark: 'gazebos',
    ambient: 'fireflies',
    enemyKind: 'crab',
    hazardKind: 'thorns',
    accentColor: '#6EB5A2',
    platformPalette: {
      top: '#4D8A7B',
      topRim: '#7FBBA9',
      body: '#232A48',
      trim: '#13182E',
    },
    stageThemes: ['night', 'night', 'night', 'night', 'sunrise'],
  },
  {
    id: 10,
    name: 'Horizon Summit',
    subtitle: 'The final ascent to their wedding chapel',
    theme: 'sunrise',
    landmark: 'chapel',
    ambient: 'petals',
    enemyKind: 'wisp',
    hazardKind: 'crystals',
    accentColor: '#F2C97D',
    platformPalette: {
      top: '#D4B272',
      topRim: '#F7DDA6',
      body: '#3C3559',
      trim: '#221D36',
    },
    stageThemes: ['night', 'sunset', 'sunrise', 'sunrise', 'sunrise'],
  },
];

// 50 unique stage titles & romantic story captions (10 Worlds x 5 Stages)
const STAGE_STORY_CATALOG = [
  // World 1: Quiet Village Outskirts
  [
    {
      title: 'Dawn Over the Quiet Village',
      caption:
        'Stepping past the village fence at first light, Madjid and Nadine hold switches together to unlock the road ahead.',
    },
    {
      title: 'Brookstone Ferry',
      caption:
        'A timber ferry spans the sleepy village creek—one sends it across while the other latches it for both.',
    },
    {
      title: 'Briar Hedge Gatehouse',
      caption:
        'Wild thorns line the orchard wall, so they split between the sunlit trellis and cobblestone lane.',
    },
    {
      title: 'Twin Bell Meadow',
      caption:
        'The old parish seal only opens when two travelers stand upon its stones in harmony.',
    },
    {
      title: 'Farewell Lantern Ridge',
      caption:
        'Looking back at their cozy roofs one last time, Madjid takes Nadine’s hand and steps into the wider world.',
    },
  ],
  // World 2: Golden Meadows
  [
    {
      title: 'Sunlit Windmill Lane',
      caption:
        'Golden wheat sways beside turning sails as dandelion fluff drifts softly across their path.',
    },
    {
      title: 'Hayloft Sky Ferry',
      caption:
        'Between tall stone silos, a gentle pulley bridge glides smoothly over the clover gorge.',
    },
    {
      title: 'Clover Archway Vault',
      caption:
        'Nadine spots a brass key sparkling above the upper beams while Madjid guards the meadow latch.',
    },
    {
      title: 'Millstone Harmony',
      caption:
        'Two ancient weight plates chime together, raising the mossy barrier to the sunlit hill.',
    },
    {
      title: 'Amber Harvest Crossing',
      caption:
        'As afternoon melts into warm dusk, the windmills wave goodbye from the rim of the valley.',
    },
  ],
  // World 3: Lantern Harbor
  [
    {
      title: 'Lighthouse Promenade',
      caption:
        'Salt air and amber pier lanterns welcome them to the seaside docks where ships prepare to sail.',
    },
    {
      title: 'Tidewater Gondola',
      caption:
        'A swaying harbor raft carries them above the evening tide while tiny shore crabs scuttle along the planks.',
    },
    {
      title: 'Boardwalk Belltower',
      caption:
        'Climbing the rigging ledges together, they unlock the harbor master’s dual-key boathouse.',
    },
    {
      title: 'Anchor Seal Pier',
      caption:
        'Both sea-stone switches click down in unison, hoisting the weathered timber floodgate.',
    },
    {
      title: 'Starlit Breakwater',
      caption:
        'Under the first stars over the bay, warm lanterns guide Madjid and Nadine toward the coastal cliffs.',
    },
  ],
  // World 4: Sunset Cliffs
  [
    {
      title: 'Terracotta Overlook',
      caption:
        'High above the sea, painted sandstone ledges glow rose-gold in the lingering afternoon sun.',
    },
    {
      title: 'Viaduct Canyon Span',
      caption:
        'An aqueduct cable car glides gracefully between carved red-stone pillars.',
    },
    {
      title: 'Canyon Archway Gallery',
      caption:
        'Upper colonnades and lower pathways weave together beneath the sweeping cliffside bridge.',
    },
    {
      title: 'Twin Pillar Covenant',
      caption:
        'Standing across the sunlit chasm, they weigh down the twin seals to open the mountain gate.',
    },
    {
      title: 'Twilight Aqueduct Summit',
      caption:
        'The last rays of sunset dip below the arches, revealing a cool starlit trail into the dunes.',
    },
  ],
  // World 5: Starry Desert
  [
    {
      title: 'Crescent Oasis Gate',
      caption:
        'Beneath a silver crescent moon, palm shadows and lantern posts shimmer across the peaceful sands.',
    },
    {
      title: 'Dune Wind Skiff',
      caption:
        'A silent desert skiff carries them smoothly over the cool midnight valley between sandstone bluffs.',
    },
    {
      title: 'Astronomer’s Balcony',
      caption:
        'Guided by fireflies and constellations, they gather twin brass keys from the quiet oasis rooftops.',
    },
    {
      title: 'Mirage Seal Courtyard',
      caption:
        'Two starlight plinths answer only to partners standing together in the hush of the desert night.',
    },
    {
      title: 'Caravan of a Thousand Stars',
      caption:
        'Crossing the final moonlit minaret, Madjid and Nadine rest beneath the sky and dream of tomorrow.',
    },
  ],
  // World 6: Misty Highlands
  [
    {
      title: 'Pine Ridge Sunrise',
      caption:
        'Cool mist lifts off evergreen peaks as golden dawn warms the mossy mountain steps.',
    },
    {
      title: 'Highland Timber Tram',
      caption:
        'Playful mountain wisps drift along the cliffs while their rope tram crosses the crisp ravine.',
    },
    {
      title: 'Shepherd’s Dual Trail',
      caption:
        'One takes the breezy cliffside path while the other raises the timber lift below.',
    },
    {
      title: 'Cairn of Two Hearts',
      caption:
        'Built by travelers long ago, the twin cairn stones part the highland gate when pressed together.',
    },
    {
      title: 'Cloudline Overlook',
      caption:
        'At the crest of the pine pass, dusk clouds gather softly right beneath their feet.',
    },
  ],
  // World 7: Cloud Bridges
  [
    {
      title: 'Porcelain Sky Terrace',
      caption:
        'Blossom petals drift past floating pagoda eaves suspended in an apricot sunset sky.',
    },
    {
      title: 'Zephyr Pavilion Ferry',
      caption:
        'A rosy cloud-skiff glides between ivory islands while shimmering shards guard the edge.',
    },
    {
      title: 'Pagoda Lantern Walk',
      caption:
        'Hopping gracefully across tiered eaves, Madjid and Nadine unlock the skyward shrine.',
    },
    {
      title: 'Harmony Bell Bridges',
      caption:
        'Two sky chimes ring in unison, parting the rose-gold barrier high above the drifting clouds.',
    },
    {
      title: 'Dusk Over the Sky Isles',
      caption:
        'As indigo night settles over the cloud sea, glowing crystals beckon them down to a hidden cavern.',
    },
  ],
  // World 8: Crystal Caverns
  [
    {
      title: 'Geode Lantern Entrance',
      caption:
        'Soft teal crystals illuminate serene underground halls filled with quiet echoes and firefly light.',
    },
    {
      title: 'Prismatic Chasm Lift',
      caption:
        'A balanced crystal ferry carries them gently across a luminous subterranean pool.',
    },
    {
      title: 'Amethyst Mirror Vault',
      caption:
        'Upper crystal ledges glitter overhead while cavern wisps hum peaceful patrols below.',
    },
    {
      title: 'Resonance Gatehouse',
      caption:
        'Simultaneous footsteps ring clear through the cavern, unsealing the sapphire vault.',
    },
    {
      title: 'Heart of the Crystal Spring',
      caption:
        'Emerging past the final glowing geode, cool night air brings the scent of blooming garden roses.',
    },
  ],
  // World 9: Moonlit Gardens
  [
    {
      title: 'Gazebo of Fireflies',
      caption:
        'Warm garden lanterns line manicured moon-jade hedges where fireflies dance between stone arches.',
    },
    {
      title: 'Lilypond Footbridge',
      caption:
        'A carved garden ferry glides across the reflective pond while shore beetles stroll the mosaic walk.',
    },
    {
      title: 'Rose Trellis Courtyard',
      caption:
        'Climbing fragrant ivy terraces, Madjid and Nadine gather the garden’s twin golden keys.',
    },
    {
      title: 'Lover’s Fountain Seal',
      caption:
        'Two moonlit flagstones chime softly together, parting the wrought-iron hedge gate.',
    },
    {
      title: 'Dawn Gate of the Conservatory',
      caption:
        'Morning light breaks over the tall cypress trees, revealing the grand summit path ahead.',
    },
  ],
  // World 10: Horizon Summit
  [
    {
      title: 'Starlit Summit Steps',
      caption:
        'Beneath the last quiet stars of their journey, every lesson learned side by side guides their steps.',
    },
    {
      title: 'Golden Hour Skyway',
      caption:
        'Warm amber clouds swirl around ivory marble piers as the chapel bells echo in the distance.',
    },
    {
      title: 'Chapel Bell Gallery',
      caption:
        'Sunrise spills across the upper arches while Madjid and Nadine unlock the sunlit sanctuary.',
    },
    {
      title: 'Vow of the Twin Pillars',
      caption:
        'One last twin-seal gate parts effortlessly as they stand together in perfect rhythm.',
    },
    {
      title: 'The Wedding Horizon',
      caption:
        'After fifty unforgettable horizons around the world, Madjid and Nadine step hand in hand beneath their wedding arch.',
    },
  ],
];

const SWITCH_COLORS = ['#F59E0B', '#38BDF8', '#F472B6', '#34D399', '#A78BFA'];

function getEnemySpeed(worldIdx, stageIdx) {
  return Math.round(54 + worldIdx * 6.5 + stageIdx * 3.5);
}

/**
 * Blueprint 1 (Stage 1 of each world): Gatehouse, Lift & Meadow Approach.
 * World 1 Stage 1 has zero hazards/enemies for a gentle, welcoming opening.
 */
function buildStage1(world, worldIdx, meta) {
  const id = worldIdx * 5 + 1;
  const worldWidth = 1280 + Math.min(220, worldIdx * 24);
  const theme = world.stageThemes[0];
  const liftColor = SWITCH_COLORS[worldIdx % SWITCH_COLORS.length];
  const altColor = SWITCH_COLORS[(worldIdx + 1) % SWITCH_COLORS.length];
  const hasCanyonGap = worldIdx >= 2;
  const isTutorial = worldIdx === 0;
  const swAId = isTutorial ? 'sw_1a' : `sw_${id}_a`;
  const swBId = isTutorial ? 'sw_1b' : `sw_${id}_b`;
  const gateId = isTutorial ? 'gate_1' : `gate_${id}`;
  const liftId = isTutorial ? 'lift_1' : `lift_${id}`;

  const platforms = [];
  if (hasCanyonGap) {
    platforms.push({ x: 0, y: 600, w: 300, h: 120, kind: 'ground' });
    platforms.push({ x: 404, y: 600, w: 256, h: 120, kind: 'ground' });
  } else {
    platforms.push({ x: 0, y: 600, w: 660, h: 120, kind: 'ground' });
  }
  platforms.push({ x: 660, y: 600, w: worldWidth - 660, h: 120, kind: 'ground' });
  platforms.push({ x: 642, y: 396, w: 56, h: 86, kind: 'archway' });
  platforms.push({ x: 736, y: 432, w: 244, h: 24, kind: 'ledge' });
  if (worldIdx >= 4) {
    platforms.push({ x: 205, y: 516, w: 120, h: 24, kind: 'ledge' });
  }

  const switches = [
    {
      id: swAId,
      x: hasCanyonGap ? 430 : 244,
      y: 600,
      w: 48,
      mode: 'hold',
      color: liftColor,
      label: 'A',
    },
    {
      id: swBId,
      x: 724,
      y: 600,
      w: 48,
      mode: worldIdx >= 3 ? 'toggle' : 'hold',
      color: altColor,
      label: 'B',
    },
  ];

  const movingPlatforms = [
    {
      id: liftId,
      startX: 500,
      startY: 576,
      endX: 500,
      endY: 432,
      w: 112,
      h: 22,
      speed: 140 + worldIdx * 4,
      switches: [swAId],
      requireAll: false,
      color: liftColor,
    },
  ];

  const gates = [
    {
      id: gateId,
      x: 656,
      y: 482,
      w: 28,
      h: 118,
      openOffsetX: 0,
      openOffsetY: -118,
      speed: 220,
      switches: [swAId, swBId],
      requireAll: false,
      latchOnOpen: false,
      color: liftColor,
    },
  ];

  const keys = [
    {
      id: `key_${id}_1`,
      x: 856,
      y: 390,
      color: '#FBBF24',
    },
  ];

  const checkpoints = [
    {
      id: `cp_${id}_1`,
      x: 822,
      y: 600,
    },
  ];

  const hazards = [];
  if (worldIdx >= 1) {
    hazards.push({
      id: `hz_${id}_1`,
      x: 924,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    });
  }

  const enemies = [];
  if (worldIdx >= 2) {
    const enemyMaxX = Math.min(worldWidth - 196, 1180);
    if (enemyMaxX - 1004 >= 72) {
      enemies.push({
        id: `en_${id}_1`,
        x: 1030,
        y: 576,
        w: 30,
        h: 24,
        minX: 1004,
        maxX: enemyMaxX,
        speed: getEnemySpeed(worldIdx, 0),
        kind: world.enemyKind,
      });
    }
  }

  return {
    id,
    worldId: world.id,
    stageInWorld: 1,
    code: `${world.id}-1`,
    chapterLabel: `World ${world.id} · Stage 1`,
    shortCode: `W${world.id}-1`,
    worldName: world.name,
    title: meta.title,
    caption: meta.caption,
    theme,
    landmark: world.landmark,
    ambient: theme === 'night' ? 'fireflies' : world.ambient,
    worldWidth,
    worldHeight: 720,
    spawns: {
      madjid: { x: 86, y: 564 },
      nadine: { x: 136, y: 564 },
    },
    platforms,
    switches,
    movingPlatforms,
    gates,
    keys,
    checkpoints,
    hazards,
    enemies,
    exit: {
      x: worldWidth - 134,
      y: 504,
      w: 80,
      h: 96,
      keysRequired: keys.length,
    },
    decorations: [
      { type: 'signpost', x: 54, y: 600 },
      { type: 'flowers', x: 196, y: 600 },
      { type: 'lantern', x: 616, y: 600 },
      { type: 'lantern', x: worldWidth - 168, y: 600 },
    ],
  };
}

/**
 * Blueprint 2 (Stage 2 of each world): Horizontal Ferry Relay & Elevated Island.
 */
function buildStage2(world, worldIdx, meta) {
  const id = worldIdx * 5 + 2;
  const worldWidth = 1520 + Math.min(180, worldIdx * 20);
  const theme = world.stageThemes[1];
  const ferryColor = SWITCH_COLORS[(worldIdx + 1) % SWITCH_COLORS.length];
  const latchColor = SWITCH_COLORS[(worldIdx + 2) % SWITCH_COLORS.length];
  const hasSecondKey = worldIdx >= 3;

  const platforms = [
    { x: 0, y: 600, w: 380, h: 120, kind: 'ground' },
    { x: 810, y: 600, w: 290, h: 120, kind: 'ground' },
    { x: 1186, y: 564, w: worldWidth - 1186, h: 156, kind: 'ground' },
    { x: 740, y: 518, w: 110, h: 24, kind: 'ledge' },
    { x: 906, y: 452, w: 164, h: 24, kind: 'ledge' },
  ];

  if (hasSecondKey) {
    platforms.push({ x: 1106, y: 472, w: 88, h: 22, kind: 'ledge' });
    platforms.push({ x: 1236, y: 446, w: 146, h: 24, kind: 'ledge' });
  }

  const switches = [
    {
      id: `sw_${id}_a`,
      x: 274,
      y: 600,
      w: 48,
      mode: 'hold',
      color: ferryColor,
      label: 'A',
    },
    {
      id: `sw_${id}_b`,
      x: 840,
      y: 600,
      w: 48,
      mode: 'toggle',
      color: latchColor,
      label: 'B',
    },
  ];

  const movingPlatforms = [
    {
      id: `ferry_${id}`,
      startX: 404,
      startY: 572,
      endX: 668,
      endY: 572,
      w: 118,
      h: 22,
      speed: 148 + worldIdx * 5,
      switches: [`sw_${id}_a`],
      patrolSwitches: [`sw_${id}_b`],
      requireAll: false,
      color: ferryColor,
    },
  ];

  const keys = [
    {
      id: `key_${id}_1`,
      x: 988,
      y: 412,
      color: '#FBBF24',
    },
  ];
  if (hasSecondKey) {
    keys.push({
      id: `key_${id}_2`,
      x: 1308,
      y: 406,
      color: '#F472B6',
    });
  }

  const checkpoints = [
    {
      id: `cp_${id}_1`,
      x: 942,
      y: 600,
    },
  ];

  const hazards = [
    {
      id: `hz_${id}_1`,
      x: 1030,
      y: 586,
      w: 42,
      h: 14,
      kind: world.hazardKind,
    },
  ];

  const enemies = [];
  if (worldIdx >= 1) {
    enemies.push({
      id: `en_${id}_1`,
      x: 1240,
      y: 540,
      w: 30,
      h: 24,
      minX: 1218,
      maxX: worldWidth - 178,
      speed: getEnemySpeed(worldIdx, 1),
      kind: world.enemyKind,
    });
  }

  return {
    id,
    worldId: world.id,
    stageInWorld: 2,
    code: `${world.id}-2`,
    chapterLabel: `World ${world.id} · Stage 2`,
    shortCode: `W${world.id}-2`,
    worldName: world.name,
    title: meta.title,
    caption: meta.caption,
    theme,
    landmark: world.landmark,
    ambient: theme === 'night' ? 'fireflies' : world.ambient,
    worldWidth,
    worldHeight: 720,
    spawns: {
      madjid: { x: 76, y: 564 },
      nadine: { x: 126, y: 564 },
    },
    platforms,
    switches,
    movingPlatforms,
    gates: [],
    keys,
    checkpoints,
    hazards,
    enemies,
    exit: {
      x: worldWidth - 124,
      y: 468,
      w: 80,
      h: 96,
      keysRequired: keys.length,
    },
    decorations: [
      { type: 'lantern', x: 348, y: 600 },
      { type: 'flowers', x: 196, y: 600 },
      { type: 'lantern', x: 824, y: 600 },
      { type: 'lantern', x: worldWidth - 156, y: 564 },
    ],
  };
}

/**
 * Blueprint 3 (Stage 3 of each world): Split Upper/Lower Archway & Lift Vault.
 */
function buildStage3(world, worldIdx, meta) {
  const id = worldIdx * 5 + 3;
  const worldWidth = 1540 + Math.min(200, worldIdx * 20);
  const theme = world.stageThemes[2];
  const gateColor = SWITCH_COLORS[(worldIdx + 2) % SWITCH_COLORS.length];
  const liftColor = SWITCH_COLORS[(worldIdx + 3) % SWITCH_COLORS.length];

  const platforms = [
    { x: 0, y: 600, w: 720, h: 120, kind: 'ground' },
    { x: 720, y: 600, w: worldWidth - 720, h: 120, kind: 'ground' },
    { x: 190, y: 518, w: 120, h: 24, kind: 'ledge' },
    { x: 350, y: 438, w: 140, h: 24, kind: 'ledge' },
    { x: 530, y: 368, w: 220, h: 24, kind: 'ledge' },
    { x: 690, y: 392, w: 56, h: 90, kind: 'archway' },
    { x: 830, y: 380, w: 190, h: 24, kind: 'ledge' },
    { x: 1224, y: 382, w: 174, h: 24, kind: 'ledge' },
  ];

  const switches = [
    {
      id: `sw_${id}_a`,
      x: 560,
      y: 368,
      w: 48,
      mode: 'toggle',
      color: gateColor,
      label: 'A',
    },
    {
      id: `sw_${id}_b`,
      x: 882,
      y: 600,
      w: 48,
      mode: 'hold',
      color: liftColor,
      label: 'B',
    },
  ];

  const gates = [
    {
      id: `gate_${id}`,
      x: 704,
      y: 482,
      w: 28,
      h: 118,
      openOffsetX: 0,
      openOffsetY: -118,
      speed: 230,
      switches: [`sw_${id}_a`],
      requireAll: false,
      latchOnOpen: true,
      color: gateColor,
    },
  ];

  const movingPlatforms = [
    {
      id: `lift_${id}`,
      startX: 1090,
      startY: 576,
      endX: 1090,
      endY: 382,
      w: 108,
      h: 22,
      speed: 148 + worldIdx * 5,
      switches: [`sw_${id}_b`],
      requireAll: false,
      color: liftColor,
    },
  ];

  const keys = [
    {
      id: `key_${id}_1`,
      x: 656,
      y: 326,
      color: '#FBBF24',
    },
    {
      id: `key_${id}_2`,
      x: 1312,
      y: 340,
      color: '#38BDF8',
    },
  ];

  const checkpoints = [
    {
      id: `cp_${id}_1`,
      x: 806,
      y: 600,
    },
  ];

  const hazards = [
    {
      id: `hz_${id}_1`,
      x: 332,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    },
  ];

  if (worldIdx >= 2) {
    hazards.push({
      id: `hz_${id}_2`,
      x: 996,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    });
  }

  const enemies = [
    {
      id: `en_${id}_1`,
      x: 1244,
      y: 576,
      w: 30,
      h: 24,
      minX: 1218,
      maxX: worldWidth - 180,
      speed: getEnemySpeed(worldIdx, 2),
      kind: world.enemyKind,
    },
  ];

  if (worldIdx >= 1) {
    enemies.push({
      id: `en_${id}_2`,
      x: 860,
      y: 356,
      w: 30,
      h: 24,
      minX: 842,
      maxX: 980,
      speed: getEnemySpeed(worldIdx, 1),
      kind: world.enemyKind,
    });
  }

  return {
    id,
    worldId: world.id,
    stageInWorld: 3,
    code: `${world.id}-3`,
    chapterLabel: `World ${world.id} · Stage 3`,
    shortCode: `W${world.id}-3`,
    worldName: world.name,
    title: meta.title,
    caption: meta.caption,
    theme,
    landmark: world.landmark,
    ambient: theme === 'night' ? 'fireflies' : world.ambient,
    worldWidth,
    worldHeight: 720,
    spawns: {
      madjid: { x: 74, y: 564 },
      nadine: { x: 122, y: 564 },
    },
    platforms,
    switches,
    movingPlatforms,
    gates,
    keys,
    checkpoints,
    hazards,
    enemies,
    exit: {
      x: worldWidth - 130,
      y: 504,
      w: 80,
      h: 96,
      keysRequired: keys.length,
    },
    decorations: [
      { type: 'lantern', x: 164, y: 600 },
      { type: 'flowers', x: 560, y: 600 },
      { type: 'lantern', x: 762, y: 600 },
      { type: 'lantern', x: worldWidth - 166, y: 600 },
    ],
  };
}

/**
 * Blueprint 4 (Stage 4 of each world): Twin-Weight AND Seal Gate + Courtyard Patrol.
 */
function buildStage4(world, worldIdx, meta) {
  const id = worldIdx * 5 + 4;
  const worldWidth = 1680 + Math.min(160, worldIdx * 16);
  const theme = world.stageThemes[3];
  const sealColor = SWITCH_COLORS[(worldIdx + 3) % SWITCH_COLORS.length];
  const liftColor = SWITCH_COLORS[(worldIdx + 4) % SWITCH_COLORS.length];
  const isLegacyFourth = worldIdx === 0;
  const swAId = isLegacyFourth ? 'sw_4a' : `sw_${id}_a`;
  const swBId = isLegacyFourth ? 'sw_4b' : `sw_${id}_b`;
  const gateId = isLegacyFourth ? 'gate_4a' : `gate_${id}_seal`;

  const platforms = [
    { x: 0, y: 600, w: 500, h: 120, kind: 'ground' },
    { x: 595, y: 600, w: 495, h: 120, kind: 'ground' },
    { x: 1090, y: 600, w: worldWidth - 1090, h: 120, kind: 'ground' },
    { x: 236, y: 516, w: 158, h: 24, kind: 'ledge' },
    { x: 426, y: 442, w: 184, h: 24, kind: 'ledge' },
    { x: 1040, y: 394, w: 56, h: 88, kind: 'archway' },
    { x: 1416, y: 432, w: 136, h: 24, kind: 'ledge' },
  ];

  const switches = [
    {
      id: swAId,
      x: 452,
      y: 442,
      w: 48,
      mode: 'hold',
      color: sealColor,
      label: '1',
    },
    {
      id: swBId,
      x: 702,
      y: 600,
      w: 48,
      mode: 'hold',
      color: sealColor,
      label: '2',
    },
    {
      id: `sw_${id}_c`,
      x: 1200,
      y: 600,
      w: 48,
      mode: 'hold',
      color: liftColor,
      label: 'L',
    },
  ];

  const gates = [
    {
      id: gateId,
      x: 1054,
      y: 482,
      w: 28,
      h: 118,
      openOffsetX: 0,
      openOffsetY: -118,
      speed: 235,
      switches: [swAId, swBId],
      requireAll: true,
      latchOnOpen: true,
      color: sealColor,
    },
  ];

  const movingPlatforms = [
    {
      id: `lift_${id}`,
      startX: 1290,
      startY: 576,
      endX: 1290,
      endY: 432,
      w: 106,
      h: 22,
      speed: 150 + worldIdx * 5,
      switches: [`sw_${id}_c`],
      requireAll: false,
      color: liftColor,
    },
  ];

  const keys = [
    {
      id: `key_${id}_1`,
      x: 544,
      y: 400,
      color: '#FBBF24',
    },
    {
      id: `key_${id}_2`,
      x: 1484,
      y: 390,
      color: '#F472B6',
    },
  ];

  const checkpoints = [
    {
      id: `cp_${id}_1`,
      x: 634,
      y: 600,
    },
  ];
  if (worldIdx >= 2) {
    checkpoints.push({
      id: `cp_${id}_2`,
      x: 1138,
      y: 600,
    });
  }

  const hazards = [];
  if (worldIdx >= 1) {
    hazards.push({
      id: `hz_${id}_1`,
      x: 424,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    });
  }
  if (worldIdx < 4) {
    hazards.push({
      id: `hz_${id}_2`,
      x: 1424,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    });
  }

  const enemies = [
    {
      id: `en_${id}_1`,
      x: 820,
      y: 576,
      w: 30,
      h: 24,
      minX: 794,
      maxX: 988,
      speed: getEnemySpeed(worldIdx, 3),
      kind: world.enemyKind,
    },
  ];

  if (worldIdx >= 4) {
    enemies.push({
      id: `en_${id}_2`,
      x: 1440,
      y: 576,
      w: 30,
      h: 24,
      minX: 1418,
      maxX: worldWidth - 170,
      speed: getEnemySpeed(worldIdx, 2),
      kind: world.enemyKind,
    });
  }

  return {
    id,
    worldId: world.id,
    stageInWorld: 4,
    code: `${world.id}-4`,
    chapterLabel: `World ${world.id} · Stage 4`,
    shortCode: `W${world.id}-4`,
    worldName: world.name,
    title: meta.title,
    caption: meta.caption,
    theme,
    landmark: world.landmark,
    ambient: theme === 'night' ? 'fireflies' : world.ambient,
    worldWidth,
    worldHeight: 720,
    spawns: {
      madjid: { x: 72, y: 564 },
      nadine: { x: 120, y: 564 },
    },
    platforms,
    switches,
    movingPlatforms,
    gates,
    keys,
    checkpoints,
    hazards,
    enemies,
    exit: {
      x: worldWidth - 120,
      y: 504,
      w: 80,
      h: 96,
      keysRequired: keys.length,
    },
    decorations: [
      { type: 'flowers', x: 196, y: 600 },
      { type: 'lantern', x: 484, y: 600 },
      { type: 'lantern', x: 1018, y: 600 },
      { type: 'lantern', x: worldWidth - 154, y: 600 },
    ],
  };
}

/**
 * Blueprint 5 (Stage 5 of each world): Grand World Finale — Ferry + Twin Seal + 2 Checkpoints.
 * Level 50 (World 10 · Stage 5) culminates at the Wedding Arch!
 */
function buildStage5(world, worldIdx, meta) {
  const id = worldIdx * 5 + 5;
  const worldWidth = Math.min(1880, 1760 + worldIdx * 14);
  const theme = world.stageThemes[4];
  const ferryColor = SWITCH_COLORS[worldIdx % SWITCH_COLORS.length];
  const latchColor = SWITCH_COLORS[(worldIdx + 1) % SWITCH_COLORS.length];
  const sealColor = SWITCH_COLORS[(worldIdx + 2) % SWITCH_COLORS.length];
  const hasThirdKey = worldIdx >= 4;
  const isWeddingFinale = id === 50;

  const platforms = [
    { x: 0, y: 600, w: 380, h: 120, kind: 'ground' },
    { x: 750, y: 600, w: 490, h: 120, kind: 'ground' },
    { x: 1240, y: 600, w: worldWidth - 1240, h: 120, kind: 'ground' },
    { x: 214, y: 516, w: 112, h: 24, kind: 'ledge' },
    { x: 370, y: 440, w: 220, h: 24, kind: 'ledge' },
    { x: 678, y: 490, w: 112, h: 22, kind: 'ledge' },
    { x: 866, y: 446, w: 244, h: 24, kind: 'ledge' },
    { x: 1122, y: 516, w: 80, h: 22, kind: 'ledge' },
    { x: 1212, y: 394, w: 56, h: 88, kind: 'archway' },
  ];

  if (hasThirdKey) {
    platforms.push({ x: 1450, y: 516, w: 86, h: 22, kind: 'ledge' });
    platforms.push({ x: 1554, y: 444, w: 120, h: 24, kind: 'ledge' });
  }

  const switches = [
    {
      id: `sw_${id}_ferry`,
      x: 274,
      y: 600,
      w: 48,
      mode: 'hold',
      color: ferryColor,
      label: 'A',
    },
    {
      id: `sw_${id}_patrol`,
      x: 780,
      y: 600,
      w: 48,
      mode: 'toggle',
      color: latchColor,
      label: 'B',
    },
    {
      id: `sw_${id}_seal_a`,
      x: 1044,
      y: 446,
      w: 48,
      mode: 'hold',
      color: sealColor,
      label: '1',
    },
    {
      id: `sw_${id}_seal_b`,
      x: 1148,
      y: 600,
      w: 48,
      mode: 'hold',
      color: sealColor,
      label: '2',
    },
  ];

  const movingPlatforms = [
    {
      id: `ferry_${id}`,
      startX: 400,
      startY: 572,
      endX: 618,
      endY: 572,
      w: 112,
      h: 22,
      speed: 152 + worldIdx * 5,
      switches: [`sw_${id}_ferry`],
      patrolSwitches: [`sw_${id}_patrol`],
      requireAll: false,
      color: ferryColor,
    },
  ];

  const gates = [
    {
      id: `gate_${id}_seal`,
      x: 1226,
      y: 482,
      w: 28,
      h: 118,
      openOffsetX: 0,
      openOffsetY: -118,
      speed: 240,
      switches: [`sw_${id}_seal_a`, `sw_${id}_seal_b`],
      requireAll: true,
      latchOnOpen: true,
      color: sealColor,
    },
  ];

  const keys = [
    {
      id: `key_${id}_1`,
      x: 480,
      y: 398,
      color: '#FBBF24',
    },
    {
      id: `key_${id}_2`,
      x: 960,
      y: 404,
      color: '#F472B6',
    },
  ];
  if (hasThirdKey) {
    keys.push({
      id: `key_${id}_3`,
      x: 1614,
      y: 402,
      color: '#38BDF8',
    });
  }

  const checkpoints = [
    {
      id: `cp_${id}_1`,
      x: 862,
      y: 600,
    },
    {
      id: `cp_${id}_2`,
      x: 1296,
      y: 600,
    },
  ];

  const hazards = [
    {
      id: `hz_${id}_1`,
      x: 1378,
      y: 586,
      w: 44,
      h: 14,
      kind: world.hazardKind,
    },
  ];

  const enemies = [
    {
      id: `en_${id}_1`,
      x: 960,
      y: 576,
      w: 30,
      h: 24,
      minX: 924,
      maxX: 1102,
      speed: getEnemySpeed(worldIdx, 3),
      kind: world.enemyKind,
    },
  ];

  const enemy2MinX = hasThirdKey ? 1548 : 1468;
  const enemy2MaxX = worldWidth - 170;
  if (worldIdx >= 1 && enemy2MaxX - enemy2MinX >= 72) {
    enemies.push({
      id: `en_${id}_2`,
      x: enemy2MinX + 20,
      y: 576,
      w: 30,
      h: 24,
      minX: enemy2MinX,
      maxX: enemy2MaxX,
      speed: getEnemySpeed(worldIdx, 4),
      kind: world.enemyKind,
    });
  }

  return {
    id,
    worldId: world.id,
    stageInWorld: 5,
    code: `${world.id}-5`,
    chapterLabel: `World ${world.id} · Stage 5`,
    shortCode: `W${world.id}-5`,
    worldName: world.name,
    title: meta.title,
    caption: meta.caption,
    theme,
    landmark: world.landmark,
    ambient: theme === 'night' ? 'fireflies' : world.ambient,
    worldWidth,
    worldHeight: 720,
    spawns: {
      madjid: { x: 70, y: 564 },
      nadine: { x: 118, y: 564 },
    },
    platforms,
    switches,
    movingPlatforms,
    gates,
    keys,
    checkpoints,
    hazards,
    enemies,
    exit: {
      x: worldWidth - 122,
      y: 504,
      w: 80,
      h: 96,
      keysRequired: keys.length,
      isWeddingArch: isWeddingFinale,
    },
    decorations: [
      { type: 'signpost', x: 40, y: 600 },
      { type: 'flowers', x: 184, y: 600 },
      { type: 'lantern', x: 348, y: 600 },
      { type: 'lantern', x: 760, y: 600 },
      { type: 'lantern', x: 1268, y: 600 },
      { type: 'lantern', x: worldWidth - 152, y: 600 },
      ...(isWeddingFinale
        ? [
            { type: 'flowers', x: worldWidth - 186, y: 600 },
            { type: 'flowers', x: worldWidth - 36, y: 600 },
          ]
        : []),
    ],
  };
}

const STAGE_BUILDERS = [buildStage1, buildStage2, buildStage3, buildStage4, buildStage5];

function buildCampaignLevels() {
  const built = [];
  for (let wIdx = 0; wIdx < WORLDS.length; wIdx++) {
    const world = WORLDS[wIdx];
    const storyPack = STAGE_STORY_CATALOG[wIdx];
    for (let sIdx = 0; sIdx < 5; sIdx++) {
      built.push(STAGE_BUILDERS[sIdx](world, wIdx, storyPack[sIdx]));
    }
  }
  return built;
}

export const LEVELS = buildCampaignLevels();

export function getWorldById(worldId) {
  return WORLDS.find((w) => w.id === worldId) || WORLDS[0];
}

export function getLevelsForWorld(worldId) {
  return LEVELS.filter((lvl) => lvl.worldId === worldId);
}

export function getLevelByIndex(index) {
  const safe = Math.max(0, Math.min(LEVELS.length - 1, index));
  return LEVELS[safe];
}

/**
 * Modular expansion hook: register future worlds & level packs cleanly at runtime
 * without touching physics, skins, background, or core engine code.
 */
export function registerWorldPack(worldDef, worldLevels) {
  if (!worldDef || typeof worldDef.id !== 'number' || !worldDef.name) {
    throw new Error('World pack requires numeric id and name.');
  }
  if (!Array.isArray(worldLevels) || worldLevels.length === 0) {
    throw new Error('World pack requires a non-empty array of level definitions.');
  }

  const existingWorldIdx = WORLDS.findIndex((w) => w.id === worldDef.id);
  if (existingWorldIdx >= 0) {
    WORLDS[existingWorldIdx] = worldDef;
  } else {
    WORLDS.push(worldDef);
  }

  for (let i = 0; i < worldLevels.length; i++) {
    const lvl = {
      ...worldLevels[i],
      worldId: worldDef.id,
      worldName: worldLevels[i].worldName || worldDef.name,
    };
    const existingLvlIdx = LEVELS.findIndex((existing) => existing.id === lvl.id);
    if (existingLvlIdx >= 0) {
      LEVELS[existingLvlIdx] = lvl;
    } else {
      LEVELS.push(lvl);
    }
  }

  return { world: worldDef, totalWorlds: WORLDS.length, totalLevels: LEVELS.length };
}
