/**
 * src/puzzles.js
 * Hard In-World Logic Puzzles rendered strictly on Canvas2D (no DOM menus).
 *
 * Puzzle types:
 * 1. alignment_pillars: Rotate 3 carved stone pillars to match Ancient Stone Tablet glyphs
 *    in the world before unlocking the linked gate/bridge.
 * 2. ordered_levers: Pull rune levers in the exact carved glyph order shown on a nearby mural.
 * 3. sync_plates: Both Madjid & Nadine must step onto dual pressure rune pads inside a tight
 *    window while matching a symbol pair.
 * 4. conduit_locks: Activate energy crystal nodes with Energy Wand or Mechanism Key to route
 *    power through glowing floor conduits into a locked bulkhead/door.
 */

export const PUZZLE_GLYPHS = [
  { id: 'sun', label: 'Sun', color: '#FBBF24' },
  { id: 'moon', label: 'Moon', color: '#93C5FD' },
  { id: 'leaf', label: 'Leaf', color: '#4ADE80' },
  { id: 'wave', label: 'Wave', color: '#22D3EE' },
  { id: 'star', label: 'Star', color: '#FDE047' },
];

/**
 * Checks whether a checkpoint's linked seal puzzle (if any) has been solved.
 * Unlinked checkpoints (e.g., introductory checkpoints) are always unlocked.
 * @param {any} state
 * @param {any} cp
 */
export function isCheckpointUnlocked(state, cp) {
  if (!cp || !cp.requiresPuzzleId) return true;
  if (!state || !Array.isArray(state.puzzles)) return true;
  const linked = state.puzzles.find((p) => p && p.id === cp.requiresPuzzleId);
  if (!linked) return true;
  return Boolean(linked.solved);
}

/**
 * Instantiates mutable puzzle objects from level definitions.
 * @param {any[]} defs
 */
export function createPuzzlesForLevel(defs = []) {
  return defs.map((def, idx) => ({
    id: def.id || `puz_${idx}`,
    kind: def.kind || 'alignment_pillars',
    title: def.title || 'Ancient Seal',
    tabletX: def.tabletX ?? (def.x || 400) - 90,
    tabletY: def.tabletY ?? (def.y || 500),
    hintText: def.hintText || 'Match the carved stone glyphs',
    riddleLines: Array.isArray(def.riddleLines) && def.riddleLines.length > 0
      ? [...def.riddleLines]
      : [def.hintText || 'Read the carved seal and align the runes.'],
    targetSequence: Array.isArray(def.targetSequence) ? [...def.targetSequence] : ['sun', 'moon', 'leaf'],
    nodes: (def.nodes || []).map((n, nIdx) => ({
      id: n.id || `node_${nIdx}`,
      x: n.x,
      y: n.y,
      w: n.w || 34,
      h: n.h || 52,
      glyphIndex: typeof n.initialGlyphIndex === 'number' ? n.initialGlyphIndex : nIdx % PUZZLE_GLYPHS.length,
      activated: Boolean(n.activated),
      expectedOrder: typeof n.expectedOrder === 'number' ? n.expectedOrder : nIdx,
      pulse: 0,
    })),
    enteredOrder: /** @type {string[]} */ ([]),
    solved: false,
    stuckTimer: 0,
    hintRevealLevel: 0,
    targetGateId: def.targetGateId || null,
    targetBridgePlatformId: def.targetBridgePlatformId || null,
    flashTimer: 0,
    errorTimer: 0,
  }));
}

/**
 * Handles direct player E / Action interaction or Energy Wand zap near a puzzle node.
 * @param {any} state
 * @param {any} actor
 * @param {{ toolId?: string | null; maxDist?: number }} opts
 * @param {any} callbacks
 */
export function interactWithNearbyPuzzle(state, actor, opts = {}, callbacks = {}) {
  if (!state || !Array.isArray(state.puzzles) || !actor) return { ok: false };
  const acx = actor.x + actor.w * 0.5;
  const acy = actor.y + actor.h * 0.5;
  const maxDist = opts.maxDist || 76;

  for (let p = 0; p < state.puzzles.length; p++) {
    const puzzle = state.puzzles[p];
    if (puzzle.solved) continue;

    for (let i = 0; i < puzzle.nodes.length; i++) {
      const node = puzzle.nodes[i];
      const ncx = node.x + node.w * 0.5;
      const ncy = node.y - node.h * 0.5;
      if (Math.hypot(acx - ncx, acy - ncy) > maxDist) continue;

      if (puzzle.kind === 'conduit_locks') {
        const tool = opts.toolId || actor.equippedWeapon;
        const okTool =
          tool === 'energy_wand' ||
          tool === 'star_wand' ||
          tool === 'mechanism_key';
        if (!okTool && !opts.allowHand) {
          puzzle.errorTimer = 0.8;
          callbacks.onPuzzleMismatch?.({ puzzle, node, reason: 'Needs Energy Wand or Key' });
          return { ok: false, reason: 'NEEDS_TOOL', puzzle };
        }
        node.activated = true;
        node.pulse = 1;
        callbacks.onPuzzleStep?.({ puzzle, node });
        checkPuzzleCompletion(state, puzzle, callbacks);
        return { ok: true, puzzle, node };
      }

      if (puzzle.kind === 'ordered_levers') {
        if (node.activated) continue;
        const nextExpected = puzzle.enteredOrder.length;
        if (node.expectedOrder === nextExpected) {
          node.activated = true;
          node.pulse = 1;
          puzzle.enteredOrder.push(node.id);
          callbacks.onPuzzleStep?.({ puzzle, node });
          checkPuzzleCompletion(state, puzzle, callbacks);
          return { ok: true, puzzle, node };
        } else {
          // Wrong order resets levers cleanly with carved flash
          puzzle.enteredOrder = [];
          puzzle.nodes.forEach((n) => {
            n.activated = false;
            n.pulse = 0;
          });
          puzzle.errorTimer = 1.0;
          callbacks.onPuzzleMismatch?.({ puzzle, node, reason: 'Wrong sequence — levers reset' });
          return { ok: false, reason: 'WRONG_ORDER', puzzle };
        }
      }

      // Default: alignment_pillars cycles glyph
      node.glyphIndex = (node.glyphIndex + 1) % PUZZLE_GLYPHS.length;
      node.pulse = 1;
      callbacks.onPuzzleStep?.({ puzzle, node });
      checkPuzzleCompletion(state, puzzle, callbacks);
      return { ok: true, puzzle, node };
    }
  }

  return { ok: false };
}

/**
 * Checks if a puzzle meets its win condition and unlocks its linked gate/bridge.
 * @param {any} state
 * @param {any} puzzle
 * @param {any} callbacks
 */
export function checkPuzzleCompletion(state, puzzle, callbacks = {}) {
  if (!puzzle || puzzle.solved) return false;

  let solved = false;
  if (puzzle.kind === 'alignment_pillars') {
    solved =
      puzzle.nodes.length >= puzzle.targetSequence.length &&
      puzzle.targetSequence.every((glyphId, idx) => {
        const g = PUZZLE_GLYPHS[puzzle.nodes[idx]?.glyphIndex ?? -1];
        return g && g.id === glyphId;
      });
  } else if (puzzle.kind === 'ordered_levers' || puzzle.kind === 'conduit_locks' || puzzle.kind === 'sync_plates') {
    solved = puzzle.nodes.length > 0 && puzzle.nodes.every((n) => n.activated);
  }

  if (!solved) return false;
  puzzle.solved = true;
  puzzle.flashTimer = 1.4;
  unlockPuzzleTarget(state, puzzle);
  callbacks.onPuzzleSolved?.({ puzzle });
  return true;
}

/**
 * Applies puzzle completion to linked gates or bridges.
 * @param {any} state
 * @param {any} puzzle
 */
export function unlockPuzzleTarget(state, puzzle) {
  if (!state || !puzzle) return;
  if (puzzle.targetGateId && Array.isArray(state.gates)) {
    const gate = state.gates.find((g) => g.id === puzzle.targetGateId);
    if (gate) {
      gate.latchedOpen = true;
      gate.openProgress = 1;
    }
  }
  if (puzzle.targetBridgePlatformId && Array.isArray(state.movingPlatforms)) {
    const mp = state.movingPlatforms.find((m) => m.id === puzzle.targetBridgePlatformId);
    if (mp) {
      mp.latchedActive = true;
    }
  }
}

/**
 * Steps in-world puzzles each frame (sync_plates proximity, stuck timers, pulses).
 * @param {any} state
 * @param {number} dt
 * @param {any} callbacks
 */
export function stepPuzzles(state, dt, callbacks = {}) {
  if (!state || !Array.isArray(state.puzzles)) return;
  const actors = [state.actors?.madjid, state.actors?.nadine].filter(Boolean);

  for (let p = 0; p < state.puzzles.length; p++) {
    const puzzle = state.puzzles[p];
    if (puzzle.flashTimer > 0) puzzle.flashTimer = Math.max(0, puzzle.flashTimer - dt);
    if (puzzle.errorTimer > 0) puzzle.errorTimer = Math.max(0, puzzle.errorTimer - dt);

    puzzle.nodes.forEach((n) => {
      if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - dt * 2.2);
    });

    if (puzzle.solved) {
      unlockPuzzleTarget(state, puzzle);
      continue;
    }

    // Track progressive hint timer if players spend time near the puzzle unsolved
    const nearAny = actors.some(
      (a) => a && Math.abs(a.x - puzzle.tabletX) < 380
    );
    if (nearAny) {
      puzzle.stuckTimer += dt;
      if (puzzle.stuckTimer > 12) puzzle.hintRevealLevel = 1;
      if (puzzle.stuckTimer > 22) puzzle.hintRevealLevel = 2;
    }

    // Dual-player simultaneous rune plates (strictly requires 2 distinct characters)
    if (puzzle.kind === 'sync_plates') {
      const assignedActors = new Set();
      let allStepped = true;
      puzzle.nodes.forEach((node) => {
        const occupier = actors.find(
          (a) =>
            a &&
            !assignedActors.has(a.id) &&
            a.hurtTimer <= 0 &&
            a.x + a.w > node.x &&
            a.x < node.x + node.w &&
            Math.abs(a.y + a.h - node.y) <= 14
        );
        const stepped = Boolean(occupier);
        if (occupier) {
          assignedActors.add(occupier.id);
          node.pulse = 1;
        }
        node.activated = stepped;
        if (!stepped) allStepped = false;
      });
      if (allStepped && puzzle.nodes.length >= 2 && assignedActors.size >= 2) {
        checkPuzzleCompletion(state, puzzle, callbacks);
      }
    }
  }
}

function drawGlyphSymbol(ctx, glyphId, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  if (glyphId === 'sun') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
      ctx.stroke();
    }
  } else if (glyphId === 'moon') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0.35, Math.PI * 1.65);
    ctx.arc(r * 0.32, -r * 0.1, r * 0.56, Math.PI * 1.55, 0.45, true);
    ctx.closePath();
    ctx.fill();
  } else if (glyphId === 'leaf') {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.85);
    ctx.quadraticCurveTo(r * 0.85, -r * 0.1, 0, r * 0.85);
    ctx.quadraticCurveTo(-r * 0.85, -r * 0.1, 0, -r * 0.85);
    ctx.fill();
  } else if (glyphId === 'star') {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI * 0.5 + (k / 10) * Math.PI * 2;
      const rad = k % 2 === 0 ? r * 0.9 : r * 0.4;
      const sx = Math.cos(a) * rad;
      const sy = Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    // wave
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, 0);
    ctx.quadraticCurveTo(-r * 0.4, -r * 0.65, 0, 0);
    ctx.quadraticCurveTo(r * 0.4, r * 0.65, r * 0.85, 0);
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders carved Ancient Stone Tablets, rune pillars, ordered levers, conduit wires,
 * and progressive visual hints strictly on Canvas2D (no DOM menus).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} state
 * @param {number} time
 * @param {{ minX: number; maxX: number } | null} viewRange
 */
export function renderPuzzles(ctx, state, time = 0, viewRange = null) {
  if (!state || !Array.isArray(state.puzzles)) return;

  for (let p = 0; p < state.puzzles.length; p++) {
    const puzzle = state.puzzles[p];
    if (viewRange && puzzle.tabletX < viewRange.minX - 420) {
      const anyVisible = puzzle.nodes.some(
        (n) => n.x + n.w >= viewRange.minX - 100 && n.x <= viewRange.maxX + 100
      );
      if (!anyVisible && puzzle.tabletX + 80 < viewRange.minX - 100) continue;
    }

    // 1. Draw carved Ancient Stone Tablet clue slab
    const tx = puzzle.tabletX;
    const ty = puzzle.tabletY;
    const seq = puzzle.targetSequence || ['sun', 'moon', 'leaf'];
    const tabletW = Math.max(68, seq.length * 19 + 14);
    ctx.save();
    ctx.fillStyle = puzzle.solved ? '#29433E' : '#323A4F';
    ctx.strokeStyle = puzzle.solved ? '#6EE7B7' : '#94A3B8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(tx - tabletW * 0.5, ty - 68, tabletW, 68, [16, 16, 4, 4]);
    ctx.fill();
    ctx.stroke();

    // Carved target glyph sequence on tablet face
    if (puzzle.kind === 'alignment_pillars' || puzzle.kind === 'ordered_levers') {
      const span = (seq.length - 1) * 19;
      for (let s = 0; s < seq.length; s++) {
        const glyphMeta = PUZZLE_GLYPHS.find((g) => g.id === seq[s]) || PUZZLE_GLYPHS[0];
        const gx = tx - span * 0.5 + s * 19;
        const gy = ty - 34;
        drawGlyphSymbol(ctx, glyphMeta.id, gx, gy, 7.2, puzzle.solved ? '#6EE7B7' : glyphMeta.color);
      }
    } else if (puzzle.kind === 'conduit_locks') {
      drawGlyphSymbol(ctx, 'wave', tx, ty - 36, 11, puzzle.solved ? '#6EE7B7' : '#38BDF8');
    } else {
      drawGlyphSymbol(ctx, 'sun', tx - 12, ty - 36, 8, '#FBBF24');
      drawGlyphSymbol(ctx, 'moon', tx + 12, ty - 36, 8, '#93C5FD');
    }

    // Small engraved label underneath tablet crest
    ctx.font = '700 9px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = puzzle.solved ? '#A7F3D0' : '#E2E8F0';
    ctx.fillText(puzzle.solved ? 'SEAL OPEN' : 'STONE CLUE', tx, ty - 10);

    // Written Riddle Scroll Plaque shown on Canvas2D whenever either player approaches tablet
    const riddleActors = [state.actors?.madjid, state.actors?.nadine].filter(Boolean);
    const readerNear = riddleActors.some(
      (a) => Math.hypot(a.x + a.w * 0.5 - tx, a.y + a.h * 0.5 - (ty - 24)) <= 280
    );
    if (readerNear && Array.isArray(puzzle.riddleLines) && puzzle.riddleLines.length > 0) {
      const lines = puzzle.riddleLines.slice(0, 3);
      ctx.font = '600 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
      let maxLineW = 140;
      for (let li = 0; li < lines.length; li++) {
        maxLineW = Math.max(maxLineW, ctx.measureText(lines[li]).width);
      }
      ctx.font = '800 10px "Plus Jakarta Sans", system-ui, sans-serif';
      const titleText = puzzle.solved ? `${puzzle.title} · Solved` : `Riddle · ${puzzle.title}`;
      maxLineW = Math.max(maxLineW, ctx.measureText(titleText).width);

      const boxW = Math.min(286, maxLineW + 24);
      const boxH = 26 + lines.length * 14;
      const bx = tx - boxW * 0.5;
      const by = ty - 78 - boxH;

      const cardGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
      cardGrad.addColorStop(0, puzzle.solved ? 'rgba(20, 62, 52, 0.92)' : 'rgba(22, 34, 56, 0.92)');
      cardGrad.addColorStop(1, puzzle.solved ? 'rgba(13, 42, 38, 0.88)' : 'rgba(15, 24, 42, 0.88)');
      ctx.fillStyle = cardGrad;
      ctx.strokeStyle = puzzle.solved ? 'rgba(110, 231, 183, 0.78)' : 'rgba(186, 230, 253, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);
      ctx.fill();
      ctx.stroke();

      // Subtle inner specular rim
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx + 1.5, by + 1.5, boxW - 3, boxH * 0.45, 10);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '800 10px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = puzzle.solved ? '#6EE7B7' : '#FDE68A';
      ctx.fillText(titleText, tx, by + 14);

      ctx.font = '600 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = '#F1F5F9';
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], tx, by + 29 + li * 14, boxW - 18);
      }
    }
    ctx.restore();

    // 2. Draw interactive puzzle nodes + glowing wires to target gate
    const gate = state.gates?.find((g) => g.id === puzzle.targetGateId);
    for (let i = 0; i < puzzle.nodes.length; i++) {
      const node = puzzle.nodes[i];
      const ncx = node.x + node.w * 0.5;
      const ncy = node.y - node.h * 0.5;

      // Conduit wire to gate
      if (gate) {
        const gcx = gate.x + gate.w * 0.5;
        const gcy = gate.y + gate.h * 0.5;
        ctx.save();
        ctx.strokeStyle =
          puzzle.solved || node.activated
            ? 'rgba(110, 231, 183, 0.72)'
            : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = puzzle.solved || node.activated ? 3 : 2;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -time * 24;
        ctx.beginPath();
        ctx.moveTo(ncx, node.y - 8);
        ctx.lineTo(gcx, gcy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.save();
      if (puzzle.kind === 'sync_plates') {
        ctx.fillStyle = node.activated ? '#34D399' : '#475569';
        ctx.strokeStyle = node.activated ? '#ECFDF5' : '#94A3B8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(node.x, node.y - 10, node.w, 10, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        // Pillar, lever, or conduit node
        const errShake = puzzle.errorTimer > 0 ? Math.sin(time * 48) * 3 : 0;
        ctx.translate(errShake, 0);
        ctx.fillStyle = puzzle.solved
          ? '#1E4A3E'
          : node.activated
            ? '#23495E'
            : '#2A3144';
        ctx.strokeStyle =
          puzzle.errorTimer > 0
            ? '#F87171'
            : puzzle.solved || node.activated
              ? '#6EE7B7'
              : '#94A3B8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.roundRect(node.x, node.y - node.h, node.w, node.h, [10, 10, 4, 4]);
        ctx.fill();
        ctx.stroke();

        const glyph =
          puzzle.kind === 'alignment_pillars'
            ? PUZZLE_GLYPHS[node.glyphIndex % PUZZLE_GLYPHS.length]
            : PUZZLE_GLYPHS[i % PUZZLE_GLYPHS.length];
        drawGlyphSymbol(
          ctx,
          glyph.id,
          ncx,
          ncy - 4,
          10,
          puzzle.solved || node.activated ? '#6EE7B7' : glyph.color
        );

        // Prompt "[E]" when an actor stands nearby
        const actors = [state.actors?.madjid, state.actors?.nadine].filter(Boolean);
        const actorNear = actors.some(
          (a) => Math.hypot(a.x + a.w * 0.5 - ncx, a.y + a.h * 0.5 - ncy) < 76
        );
        if (actorNear && !puzzle.solved) {
          ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FEF3C7';
          ctx.fillText(
            puzzle.kind === 'conduit_locks' ? 'Zap / [E]' : '[E] Turn',
            ncx,
            node.y - node.h - 10
          );
        }

        // Progressive visual hint glow if player seems stuck
        if (puzzle.hintRevealLevel >= 1 && !puzzle.solved && puzzle.kind === 'alignment_pillars') {
          const targetId = puzzle.targetSequence[i];
          const matches = glyph.id === targetId;
          ctx.fillStyle = matches ? '#4ADE80' : '#FBBF24';
          ctx.beginPath();
          ctx.arc(ncx, node.y - node.h + 8, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}
