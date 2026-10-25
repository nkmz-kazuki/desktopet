const PET_WIDTH = 403;
const PET_HEIGHT = 604;
const ORIGIN_X = PET_WIDTH * 0.55;
const LEGACY_ANCHOR_X = 376 + ORIGIN_X;
const LEGACY_ANCHOR_Y = 724;
const PANEL_GAP = 12;
const FRAME_MARGIN = 8;
const PET_BOTTOM_OVERFLOW = 20;

function clamp(value, min, max) {
  return Math.min(Math.max(min, max), Math.max(min, value));
}

function anchorFromLegacyPosition(position) {
  return { x: position.x + LEGACY_ANCHOR_X, y: position.y + LEGACY_ANCHOR_Y };
}

function resolveDesktopLayout({ petAnchor, scale = 1, workArea }) {
  const area = { ...workArea };
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const requestedScale = Number.isFinite(scale) ? clamp(scale, 0.01, 1.18) : 1;
  const effectiveScale = Math.max(0.01, Math.min(requestedScale,
    (area.height - 16) / PET_HEIGHT, (area.width - 8) / (PET_WIDTH * 0.875)));
  const desired = petAnchor && Number.isFinite(petAnchor.x) && Number.isFinite(petAnchor.y)
    ? petAnchor : { x: right - 194.35, y: bottom - 4 };
  const anchor = {
    x: clamp(desired.x, area.x + 4 + ORIGIN_X * effectiveScale,
      right - 4 - PET_WIDTH * (0.875 - 0.55) * effectiveScale),
    y: clamp(desired.y, area.y + FRAME_MARGIN + PET_HEIGHT * effectiveScale, bottom + PET_BOTTOM_OVERFLOW),
  };
  const pet = {
    left: anchor.x - ORIGIN_X * effectiveScale,
    right: anchor.x + (PET_WIDTH - ORIGIN_X) * effectiveScale,
    top: anchor.y - PET_HEIGHT * effectiveScale,
    bottom: anchor.y,
  };
  const panelWidth = Math.min(374, area.width - FRAME_MARGIN * 2);
  const panelHeight = Math.min(654, area.height - FRAME_MARGIN * 2);
  const leftSpace = pet.left - PANEL_GAP - (area.x + FRAME_MARGIN);
  const rightSpace = right - FRAME_MARGIN - pet.right - PANEL_GAP;
  let panelSide;
  if (leftSpace >= panelWidth && rightSpace >= panelWidth) {
    panelSide = (pet.left + pet.right) / 2 < area.x + area.width / 2 ? 'right' : 'left';
  } else if (leftSpace >= panelWidth) panelSide = 'left';
  else if (rightSpace >= panelWidth) panelSide = 'right';
  else panelSide = rightSpace > leftSpace ? 'right' : 'left';
  const panel = {
    x: clamp(panelSide === 'right' ? pet.right + PANEL_GAP : pet.left - PANEL_GAP - panelWidth,
      area.x + FRAME_MARGIN, right - FRAME_MARGIN - panelWidth),
    y: clamp((pet.top + pet.bottom - panelHeight) / 2, area.y + FRAME_MARGIN, bottom - FRAME_MARGIN - panelHeight),
    width: panelWidth, height: panelHeight,
  };
  const greetingWidth = Math.min(224, area.width - FRAME_MARGIN * 2);
  const greetingHeight = Math.min(128, area.height - FRAME_MARGIN * 2);
  const candidates = [
    { x: (pet.left + pet.right - greetingWidth) / 2, y: pet.top - greetingHeight - PANEL_GAP },
    { x: pet.right + PANEL_GAP, y: pet.top + 24 },
    { x: pet.left - PANEL_GAP - greetingWidth, y: pet.top + 24 },
  ].map((candidate) => ({ ...candidate, width: greetingWidth, height: greetingHeight }));
  const fits = (rect) => rect.x >= area.x + FRAME_MARGIN && rect.y >= area.y + FRAME_MARGIN
    && rect.x + rect.width <= right - FRAME_MARGIN && rect.y + rect.height <= bottom - FRAME_MARGIN;
  const overlap = (rect) => Math.max(0, Math.min(rect.x + rect.width, panel.x + panel.width) - Math.max(rect.x, panel.x))
    * Math.max(0, Math.min(rect.y + rect.height, panel.y + panel.height) - Math.max(rect.y, panel.y));
  let greeting = candidates.find((candidate) => fits(candidate) && overlap(candidate) === 0);
  if (!greeting) {
    greeting = candidates.map((candidate) => ({
      ...candidate,
      x: clamp(candidate.x, area.x + FRAME_MARGIN, right - FRAME_MARGIN - greetingWidth),
      y: clamp(candidate.y, area.y + FRAME_MARGIN, bottom - FRAME_MARGIN - greetingHeight),
    })).reduce((best, candidate) => overlap(candidate) < overlap(best) ? candidate : best);
  }
  const petPaint = {
    x: pet.left - 16, y: pet.top - 17 - 16,
    width: PET_WIDTH * effectiveScale + 12.59375 * effectiveScale + 32,
    height: PET_HEIGHT * effectiveScale + 17 + 47,
  };
  const menuReserve = { x: pet.left, y: pet.top, width: petPaint.width + 114, height: PET_HEIGHT * effectiveScale + 114 };
  const rectangles = [petPaint, panel, greeting, menuReserve];
  const minX = Math.max(area.x, Math.floor(Math.min(...rectangles.map((rect) => rect.x))));
  const minY = Math.max(area.y, Math.floor(Math.min(...rectangles.map((rect) => rect.y))));
  const maxX = Math.min(right, Math.ceil(Math.max(...rectangles.map((rect) => rect.x + rect.width))));
  const maxY = Math.min(bottom, Math.ceil(Math.max(...rectangles.map((rect) => rect.y + rect.height))));
  const windowBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return {
    windowBounds,
    petStage: { left: anchor.x - 257.65 - minX, top: anchor.y - LEGACY_ANCHOR_Y - minY },
    panel: { left: panel.x - minX, top: panel.y - minY, width: panel.width, height: panel.height },
    greeting: { left: greeting.x - minX, top: greeting.y - minY, width: greeting.width, maxHeight: Math.min(104, greeting.height - 24) },
    visibleBounds: { x: 0, y: 0, width: windowBounds.width, height: windowBounds.height },
    panelSide, petAnchor: anchor, scale: effectiveScale, workArea: area,
  };
}

module.exports = { resolveDesktopLayout, anchorFromLegacyPosition, PET_BOTTOM_OVERFLOW };
