/**
 * src/coop-rooms-list.js
 * Responsive Active Room List Component for `#coop-rooms-list`.
 * Dynamically renders active WebSocket rooms with room name, room code badge,
 * current game mode badge, player count (max 2), and accessible Join action.
 */

/**
 * Formats the room mode string into a clean human-readable label.
 * @param {{ mode?: string, levelIndex?: number }} room
 * @returns {string}
 */
export function formatRoomModeLabel(room) {
  if (!room) return 'Story W1-1';
  if (room.mode === 'openworld') {
    return '2D Open-World';
  }
  const idx = Number.isInteger(room.levelIndex) ? Math.max(0, room.levelIndex) : 0;
  const worldNum = Math.floor(idx / 5) + 1;
  const stageNum = (idx % 5) + 1;
  return `Story W${worldNum}-${stageNum}`;
}

/**
 * Dynamically renders the responsive list component inside `#coop-rooms-list`.
 * @param {HTMLElement | null} containerEl
 * @param {Array<object>} rooms
 * @param {{ isConnected: boolean, onJoinRoom: (room: object) => void }} options
 */
export function renderCoopRoomsListComponent(containerEl, rooms, { isConnected, onJoinRoom }) {
  if (!containerEl) return;
  const list = Array.isArray(rooms) ? rooms : [];
  containerEl.innerHTML = '';
  containerEl.dataset.roomCount = String(list.length);

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'coop-empty-text';
    empty.textContent = isConnected
      ? 'No active rooms found. Create one on the left!'
      : 'Connect to a cloud server to browse active rooms.';
    containerEl.appendChild(empty);
    return;
  }

  list.forEach((room) => {
    const maxPlayers = room.maxPlayers || 2;
    const playerCount = Number.isFinite(room.playerCount) ? room.playerCount : 1;
    const isFull = Boolean(room.isFull || playerCount >= maxPlayers);
    const modeLabel = formatRoomModeLabel(room);

    const card = document.createElement('div');
    card.className = `coop-room-card${isFull ? ' is-full' : ''}`;
    card.setAttribute('role', 'listitem');
    card.dataset.roomCode = room.code;
    card.dataset.roomMode = room.mode === 'openworld' ? 'openworld' : 'story';

    const mainCol = document.createElement('div');
    mainCol.className = 'coop-room-main';

    const nameEl = document.createElement('div');
    nameEl.className = 'coop-room-name';
    nameEl.textContent = room.name || 'Madjid & Nadine Room';

    const badgesRow = document.createElement('div');
    badgesRow.className = 'coop-room-badges';

    const codeBadge = document.createElement('span');
    codeBadge.className = 'coop-badge coop-badge-code tabular-nums';
    codeBadge.textContent = room.code;

    const modeBadge = document.createElement('span');
    modeBadge.className = `coop-badge coop-badge-mode ${
      room.mode === 'openworld' ? 'is-openworld' : 'is-story'
    }`;
    modeBadge.textContent = modeLabel;

    const countBadge = document.createElement('span');
    countBadge.className = `coop-badge coop-badge-count tabular-nums${isFull ? ' is-full' : ''}`;
    countBadge.textContent = `${playerCount}/${maxPlayers} Players`;

    badgesRow.appendChild(codeBadge);
    badgesRow.appendChild(modeBadge);
    badgesRow.appendChild(countBadge);

    mainCol.appendChild(nameEl);
    mainCol.appendChild(badgesRow);

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = `coop-mini-btn coop-room-join-btn${isFull ? '' : ' coop-mini-gold'}`;
    joinBtn.disabled = isFull;
    joinBtn.textContent = isFull ? 'Full (2/2)' : 'Join';
    joinBtn.setAttribute(
      'aria-label',
      isFull
        ? `Room ${room.code} is full (${playerCount} of ${maxPlayers} players)`
        : `Join room ${room.name} (${room.code}, ${modeLabel}, ${playerCount} of ${maxPlayers} players)`
    );
    joinBtn.addEventListener('click', () => {
      onJoinRoom?.(room);
    });

    card.appendChild(mainCol);
    card.appendChild(joinBtn);
    containerEl.appendChild(card);
  });
}
