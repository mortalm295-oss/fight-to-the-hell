import type { ParsedCommand } from './types';

function extractDistance(text: string, fallback = 14): number {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:m|meters|paces|units)?/);
  if (!match) return fallback;
  const val = Number.parseFloat(match[1]);
  if (Number.isNaN(val)) return fallback;
  return Math.max(4, Math.min(45, val));
}

function extractCardinalDirection(text: string): { dx: number; dz: number } | null {
  if (/\bnorth\b/.test(text)) return { dx: 0, dz: -1 };
  if (/\bsouth\b/.test(text)) return { dx: 0, dz: 1 };
  if (/\beast\b/.test(text)) return { dx: 1, dz: 0 };
  if (/\bwest\b/.test(text)) return { dx: -1, dz: 0 };
  if (/\bleft\b/.test(text)) return { dx: -1, dz: 0 };
  if (/\bright\b/.test(text)) return { dx: 1, dz: 0 };
  if (/\bback\b|\brear\b/.test(text)) return { dx: 0, dz: 1 };
  return null;
}

export function parseTacticalCommand(rawInput: string): ParsedCommand {
  const raw = rawInput.trim();
  const text = raw.toLowerCase();

  if (!text) {
    return {
      action: 'unknown',
      raw,
      label: 'Empty',
      feedback: 'Type an order: advance, raise shields, line formation, spread out, split.',
    };
  }

  // 1. Split / Divide squad into two independent smaller squads
  if (/\b(split|divide|halve|separate)\b/.test(text)) {
    return {
      action: 'split',
      raw,
      label: 'Split Squad',
      feedback: 'Squad divided into two independent tactical detachments.',
    };
  }

  // 2. Shield Wall / Raise Shields
  if (
    /\b(raise\s+shields?|shield\s*wall|shields?\s+up|lock\s+shields?|brace|testudo|phalanx)\b/.test(
      text,
    )
  ) {
    return {
      action: 'shield_wall',
      raw,
      label: 'Shield Wall',
      feedback: 'Shield Wall formed (+Defense, -55% incoming arrow damage, slower march).',
    };
  }

  // 3. Line Formation
  if (/\b(line\s*formation|form\s*line|line\s*up|single\s*line|rank|battle\s*line)\b/.test(text)) {
    return {
      action: 'line',
      raw,
      label: 'Line Formation',
      feedback: 'Troops aligned into a wide single battle line.',
    };
  }

  // 4. Spread Out / Disperse
  if (/\b(spread\s*out|disperse|scatter|loose\s*formation|open\s*order)\b/.test(text)) {
    return {
      action: 'dispersed',
      raw,
      label: 'Disperse',
      feedback: 'Squad dispersed with wide spacing to reduce volley damage.',
    };
  }

  // 5. Standard / Regroup Formation
  if (/\b(standard|reform|regroup|tight|close\s*ranks|column)\b/.test(text)) {
    return {
      action: 'standard',
      raw,
      label: 'Standard Formation',
      feedback: 'Squad reformed into balanced tactical block.',
    };
  }

  // 6. Hold / Halt
  if (/\b(hold|halt|stop|stand\s*ground|stay|defend\s*position)\b/.test(text)) {
    return {
      action: 'hold',
      raw,
      label: 'Hold Position',
      feedback: 'Squad holding current ground and engaging targets in range.',
    };
  }

  // 7. Retreat / Fall Back
  if (/\b(retreat|fall\s*back|withdraw|pull\s*back)\b/.test(text)) {
    const dist = extractDistance(text, 16);
    return {
      action: 'retreat',
      raw,
      label: 'Fall Back',
      distance: dist,
      feedback: `Falling back ${Math.round(dist)}m toward friendly lines.`,
    };
  }

  // 8. Flank
  if (/\b(flank|encircle|outflank)\b/.test(text)) {
    const angleOffset = /\bleft\b|\bwest\b/.test(text) ? -Math.PI * 0.42 : Math.PI * 0.42;
    return {
      action: 'flank',
      raw,
      label: 'Flank Maneuver',
      distance: extractDistance(text, 18),
      angleOffset,
      feedback: 'Executing wide flanking maneuver around enemy arc.',
    };
  }

  // 9. Advance / Move / Attack / Charge
  if (
    /\b(advance|move|march|push|forward|charge|attack|engage|scout|explore|go)\b/.test(text)
  ) {
    const dir = extractCardinalDirection(text);
    const dist = extractDistance(text, 15);
    const isMove = /\bmove\b|\bmarch\b|\bgo\b/.test(text) && !/\badvance\b|\bcharge\b/.test(text);
    return {
      action: isMove ? 'move' : 'advance',
      raw,
      label: dir ? 'Directional Move' : isMove ? 'Move' : 'Advance',
      distance: dist,
      directionVector: dir ?? undefined,
      feedback: dir
        ? `Marching ${Math.round(dist)}m on ordered vector.`
        : `Advancing ${Math.round(dist)}m along squad heading.`,
    };
  }

  return {
    action: 'unknown',
    raw,
    label: 'Unrecognized Order',
    feedback:
      'Order unclear. Try: "advance", "move north", "raise shields", "line formation", "spread out", "split", or "hold".',
  };
}
