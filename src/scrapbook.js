/**
 * src/scrapbook.js
 * Memory Scrapbook & Scenic Photo Spots
 * across Story Mode (50 stages) and 2D Open-World Mode.
 *
 * - Scenic Photo Spots mark picturesque vantage points where Madjid & Nadine can pose together
 * - Captures real cropped Canvas2D snapshots (with fallback illustrated SVG postcard if unavailable)
 * - Syncs across Co-op rooms via WebSocket (`photo:snap` / `scrapbook:updated`) & persists locally
 */

const STORAGE_SCRAPBOOK_KEY = 'nadine_scrapbook_v1';
export const MAX_SCRAPBOOK_PHOTOS = 24;

export function getPhotoSpotsForLevel(level) {
  if (!level) return [];
  const groundY = level.platforms?.[0]?.y || level.worldHeight - 108;
  const spotX = Math.round(
    Math.min(level.worldWidth - 180, Math.max(260, (level.spawns?.madjid?.x || 120) + 210))
  );
  return [
    {
      id: `spot_story_${level.id}`,
      x: spotX,
      y: groundY,
      title: `${level.worldName} Overlook`,
      location: `${level.worldName} · World ${level.worldId || level.code || 1}`,
    },
  ];
}

export function getOpenWorldPhotoSpots(groundY = 600) {
  return [
    {
      id: 'spot_ow_cottage',
      x: 420,
      y: groundY,
      title: 'Cottage Meadow Overlook',
      location: 'Wanderer Valley · West Meadow',
    },
    {
      id: 'spot_ow_lantern',
      x: 920,
      y: groundY,
      title: 'Lantern Plaza',
      location: 'Wanderer Valley · Lantern Square',
    },
    {
      id: 'spot_ow_horizon',
      x: 1900,
      y: groundY,
      title: 'Horizon Gazebo Point',
      location: 'Wanderer Valley · East Ridge',
    },
  ];
}

export function findActivePhotoSpot(spots, madjid, nadine) {
  if (!Array.isArray(spots) || !madjid || !nadine) return null;
  if (madjid.hurtTimer > 0 || nadine.hurtTimer > 0 || madjid.devouredByGhost || nadine.devouredByGhost) {
    return null;
  }

  const mx = madjid.x + madjid.w * 0.5;
  const my = madjid.y + madjid.h;
  const nx = nadine.x + nadine.w * 0.5;
  const ny = nadine.y + nadine.h;

  // Both characters should stand together near the photo landmark
  if (Math.hypot(mx - nx, my - ny) > 135) return null;

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const dm = Math.hypot(mx - spot.x, my - spot.y);
    const dn = Math.hypot(nx - spot.x, ny - spot.y);
    if (dm <= 95 && dn <= 95) {
      return spot;
    }
  }
  return null;
}

export function captureScrapbookPhoto(canvas, meta = {}) {
  let imageDataUrl = '';
  if (canvas && typeof document !== 'undefined') {
    try {
      const thumb = document.createElement('canvas');
      thumb.width = 320;
      thumb.height = 180;
      const tctx = thumb.getContext('2d');
      if (tctx) {
        tctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, thumb.width, thumb.height);
        // Add delicate storybook Polaroid border accent
        tctx.strokeStyle = 'rgba(255, 245, 224, 0.72)';
        tctx.lineWidth = 4;
        tctx.strokeRect(2, 2, thumb.width - 4, thumb.height - 4);
        imageDataUrl = thumb.toDataURL('image/jpeg', 0.82);
      }
    } catch {
      imageDataUrl = '';
    }
  }

  const now = new Date();
  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(meta.title || 'Journey Memory').slice(0, 64),
    location: String(meta.location || 'Around the World').slice(0, 72),
    skyWeather: String(meta.skyWeather || 'Golden Dawn').slice(0, 48),
    capturedAt: meta.capturedAt || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    imageDataUrl,
  };
}

export function loadLocalScrapbook() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_SCRAPBOOK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SCRAPBOOK_PHOTOS) : [];
  } catch {
    return [];
  }
}

export function saveLocalScrapbook(photos) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      STORAGE_SCRAPBOOK_KEY,
      JSON.stringify((photos || []).slice(0, MAX_SCRAPBOOK_PHOTOS))
    );
  } catch {
    // Ignore storage quota issues cleanly
  }
}

export function mergeScrapbookPhotos(existingList, incomingList) {
  const map = new Map();
  [...(incomingList || []), ...(existingList || [])].forEach((p) => {
    if (p && p.id && !map.has(p.id)) {
      map.set(p.id, p);
    }
  });
  return Array.from(map.values()).slice(0, MAX_SCRAPBOOK_PHOTOS);
}

export function renderPhotoSpots(ctx, spots, activeSpot, time) {
  if (!Array.isArray(spots) || spots.length === 0) return;

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const isActive = activeSpot && activeSpot.id === s.id;
    const pulse = 0.9 + Math.sin(time * 4 + i) * 0.1;

    ctx.save();
    ctx.translate(s.x, s.y);

    if (isActive) {
      ctx.fillStyle = 'rgba(253, 224, 71, 0.18)';
      ctx.beginPath();
      ctx.arc(0, -24, 38 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wooden Camera Tripod
    ctx.strokeStyle = '#2A1D28';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, -24);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -24);
    ctx.stroke();

    // Cute Storybook Camera Box
    ctx.fillStyle = isActive ? '#FDE047' : '#F3E8D2';
    ctx.strokeStyle = '#2B2142';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-11, -35, 22, 14, 4);
    ctx.fill();
    ctx.stroke();

    // Camera Lens
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(0, -28, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Flower accent
    ctx.fillStyle = '#F472B6';
    ctx.beginPath();
    ctx.arc(10, -35, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Floating Prompt Label when both players are posed together
    ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20, 18, 36, 0.9)';
    const txt = isActive ? 'Snap Photo (F)' : 'Photo Spot';
    ctx.strokeText(txt, 0, -42);
    ctx.fillStyle = isActive ? '#FEF08A' : 'rgba(255, 250, 240, 0.8)';
    ctx.fillText(txt, 0, -42);

    ctx.restore();
  }
}

export function triggerPhotoDownload(photo) {
  if (!photo || !photo.imageDataUrl || typeof document === 'undefined') return false;
  try {
    const a = document.createElement('a');
    a.href = photo.imageDataUrl;
    const safeTitle = String(photo.title || 'nadine-memory')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    a.download = `${safeTitle || 'memory'}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}

export function renderScrapbookGrid(containerEl, countEl, photos, { onDelete } = {}) {
  if (countEl) {
    countEl.textContent = `${photos.length} Memor${photos.length === 1 ? 'y' : 'ies'} Saved`;
  }
  if (!containerEl) return;
  containerEl.innerHTML = '';

  if (!photos || photos.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'scrapbook-empty';
    empty.textContent =
      'No photos captured yet! Stand together at a glowing Camera Photo Spot and press F (or Photo) to save your first souvenir.';
    containerEl.appendChild(empty);
    return;
  }

  photos.forEach((photo) => {
    const card = document.createElement('article');
    card.className = 'scrapbook-card';

    if (photo.imageDataUrl) {
      const img = document.createElement('img');
      img.className = 'scrapbook-thumb';
      img.src = photo.imageDataUrl;
      img.alt = photo.title;
      card.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'scrapbook-thumb scrapbook-thumb-fallback';
      placeholder.textContent = '📸 Madjid & Nadine';
      card.appendChild(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'scrapbook-card-body';

    const title = document.createElement('h3');
    title.className = 'scrapbook-card-title';
    title.textContent = photo.title;

    const meta = document.createElement('p');
    meta.className = 'scrapbook-card-meta';
    meta.textContent = `${photo.location} · ${photo.skyWeather} · ${photo.capturedAt}`;

    body.appendChild(title);
    body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'scrapbook-card-actions';

    if (photo.imageDataUrl) {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'scrapbook-dl-btn';
      dl.textContent = 'Download';
      dl.addEventListener('click', () => triggerPhotoDownload(photo));
      actions.appendChild(dl);
    }

    if (typeof onDelete === 'function') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'scrapbook-del-btn';
      del.textContent = 'Remove';
      del.addEventListener('click', () => onDelete(photo.id));
      actions.appendChild(del);
    }

    if (actions.children.length > 0) {
      body.appendChild(actions);
    }

    card.appendChild(body);
    containerEl.appendChild(card);
  });
}
