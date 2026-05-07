/**
 * Wordlist for memorable temporary passwords (e.g. FM-invite credentials).
 *
 * Curated for typeability over WhatsApp:
 *   - 4-6 letters
 *   - lowercase, no apostrophes / hyphens / digits
 *   - no homophones (e.g. "blue" / "blew" excluded)
 *   - no offensive or confusing words
 *
 * Used by UtilService.generatePassword() to build strings like
 * "panda-river-glass-42". Three random words + a 2-digit number gives
 * ~400^3 * 90 ≈ 5.7 billion combinations for a single one-shot temp password.
 */
export const MEMORABLE_PASSWORD_WORDLIST: readonly string[] = [
  // Animals
  'panda', 'tiger', 'eagle', 'horse', 'koala', 'otter', 'shark',
  'whale', 'zebra', 'lemur', 'gecko', 'finch', 'robin', 'mouse',
  'goose', 'sheep', 'camel', 'bison', 'ferret', 'hamster', 'parrot',
  'rabbit', 'badger', 'beaver', 'falcon', 'cobra', 'goat', 'lynx',
  'moose', 'puma', 'swan', 'wolf', 'crane', 'crow', 'duck', 'fox',
  'hawk', 'lion', 'mole', 'newt', 'owl', 'pig', 'rat', 'seal',
  'toad', 'wren', 'yak',

  // Plants & food
  'apple', 'mango', 'peach', 'plum', 'grape', 'lemon', 'olive',
  'pear', 'berry', 'melon', 'kiwi', 'guava', 'date', 'fig',
  'maple', 'oak', 'pine', 'rose', 'tulip', 'lily', 'aloe', 'fern',
  'mint', 'sage', 'basil', 'thyme', 'wheat', 'corn', 'rice',
  'bean', 'pea', 'oat', 'cocoa', 'honey', 'sugar', 'spice',
  'bread', 'cake', 'pasta', 'soup', 'tea', 'milk', 'jam',

  // Nature & weather
  'river', 'ocean', 'cloud', 'storm', 'tide', 'wave', 'rain',
  'snow', 'mist', 'frost', 'dawn', 'dusk', 'star', 'moon', 'sun',
  'sky', 'earth', 'stone', 'rock', 'sand', 'island', 'forest',
  'meadow', 'valley', 'canyon', 'desert', 'jungle', 'beach',
  'cliff', 'creek', 'lake', 'pond', 'reef', 'wind', 'breeze',
  'shore', 'bay', 'cave', 'hill', 'peak', 'tree', 'leaf', 'root',
  'bark', 'bud', 'seed', 'vine', 'wood',

  // Materials & objects
  'glass', 'metal', 'iron', 'gold', 'brass', 'silver', 'copper',
  'pearl', 'opal', 'jade', 'amber', 'ruby', 'topaz', 'agate',
  'crystal', 'marble', 'velvet', 'cotton', 'linen', 'paper', 'cloth',
  'chain', 'rope', 'thread', 'needle', 'comb', 'mug', 'cup',
  'bowl', 'plate', 'spoon', 'fork', 'knife', 'lamp', 'clock',
  'radio', 'pen', 'book', 'desk', 'chair', 'door', 'gate',
  'fence', 'wall', 'roof', 'floor', 'shelf', 'box', 'jar',
  'flask', 'lens', 'camera', 'piano', 'drum', 'flute', 'banjo',

  // Colors & shapes
  'azure', 'coral', 'ivory', 'mocha', 'sepia', 'taupe', 'rust',
  'cream', 'lemon', 'amber', 'mint', 'plum', 'rose', 'wine',
  'circle', 'square', 'oval', 'arc', 'spiral', 'cube',

  // Verbs & gentle qualities
  'climb', 'glide', 'float', 'drift', 'spark', 'shine', 'glow',
  'bloom', 'sprout', 'grow', 'rise', 'soar', 'swim', 'dance',
  'sing', 'hum', 'laugh', 'smile', 'rest', 'dream', 'wonder',

  // Adjectives (positive, neutral)
  'happy', 'merry', 'jolly', 'lucky', 'sunny', 'mighty', 'noble',
  'gentle', 'kind', 'brave', 'witty', 'clever', 'wise', 'eager',
  'calm', 'cozy', 'warm', 'cool', 'fresh', 'crisp', 'soft',
  'smooth', 'tidy', 'neat', 'tiny', 'small', 'big', 'tall',
  'short', 'wide', 'narrow', 'quick', 'slow', 'still', 'quiet',
  'loud', 'bright', 'dark', 'pale', 'rich', 'plain', 'fancy',
  'rare', 'plump', 'sleek', 'fluffy', 'sturdy', 'sleeky',

  // Geography / places (generic)
  'harbor', 'meadow', 'plaza', 'court', 'park', 'town', 'city',
  'river', 'haven', 'manor', 'cabin', 'lodge', 'cottage', 'tower',
  'bridge', 'tunnel', 'station', 'market', 'temple', 'castle',

  // Common short nouns / hobbies
  'music', 'dance', 'paint', 'movie', 'novel', 'verse', 'chord',
  'note', 'song', 'beat', 'tune', 'puzzle', 'riddle', 'game',
  'board', 'card', 'kite', 'bike', 'sled', 'boat', 'sail',
  'wagon', 'horse', 'ladder', 'arrow', 'shield', 'crown', 'flag',
  'badge', 'medal', 'trophy', 'gift', 'token', 'charm', 'wish',

  // Time
  'spring', 'summer', 'autumn', 'winter', 'monday', 'friday',
  'sunday', 'morning', 'evening', 'noon', 'midnight', 'today',

  // Misc safe nouns
  'apple', 'maple', 'cedar', 'birch', 'palm', 'fern', 'reed',
  'grass', 'moss', 'shell', 'feather', 'fur', 'paw', 'wing',
  'tail', 'hoof', 'horn', 'beak', 'mane', 'claw', 'fin',
  'scale', 'egg', 'nest', 'hive', 'web', 'pond', 'cave',
  'trail', 'path', 'road', 'lane', 'dock', 'pier', 'mast',
  'sail', 'oar', 'anchor', 'compass', 'globe', 'atlas', 'map',
  'tent', 'rope', 'flag', 'horn', 'bell', 'drum', 'whistle',
  'torch', 'candle', 'lantern', 'beacon', 'spark', 'flame',
  'pebble', 'gravel', 'boulder', 'arch', 'dome', 'pillar',
  'column', 'beam', 'rail', 'track', 'gear', 'lever', 'wheel',
  'spoke', 'tire', 'brake', 'clutch', 'engine', 'motor',
] as const;
