// Save slots live in this browser's localStorage. Loading reloads the page and
// rebuilds the game from the save on a fresh map (see Game.load in sim.js).
const KEY = 'ironhorizon.save.';
const PENDING = 'ironhorizon.pending';
export const SLOTS = [
  { id: 'quick', label: 'Quicksave', hint: 'Ctrl+S' },
  { id: 'auto', label: 'Autosave', hint: 'every 1 January' },
  { id: '1', label: 'Slot 1' }, { id: '2', label: 'Slot 2' }, { id: '3', label: 'Slot 3' },
];

export function writeSlot(slot, data) {
  try {
    localStorage.setItem(KEY + slot, JSON.stringify(data));
    localStorage.setItem(KEY + slot + '.meta', JSON.stringify({ ...data.meta, savedAt: data.savedAt }));
    return null;
  } catch (e) {
    return 'Could not save in this browser (' + (e.name === 'QuotaExceededError' ? 'storage full' : e.message) + ') — use Export instead';
  }
}
export function readSlot(slot) {
  try { const s = localStorage.getItem(KEY + slot); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function slotMeta(slot) {
  try { const s = localStorage.getItem(KEY + slot + '.meta'); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function deleteSlot(slot) {
  try { localStorage.removeItem(KEY + slot); localStorage.removeItem(KEY + slot + '.meta'); } catch { /* ignore */ }
}

// hand a save to the next page load
export function queueLoad(data) {
  const s = JSON.stringify(data);
  try { sessionStorage.setItem(PENDING, s); }
  catch { try { localStorage.setItem(PENDING, s); } catch { return 'Could not hand the save to the reloaded page'; } }
  location.reload();
  return null;
}
export function takePending() {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const st = store(), s = st.getItem(PENDING);
      if (s) { st.removeItem(PENDING); return JSON.parse(s); }
    } catch { /* storage unavailable */ }
  }
  return null;
}

export function download(data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `iron-horizon-${data.meta.date.replace(/\s+/g, '-')}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { try { res(JSON.parse(r.result)); } catch { rej(new Error('Not a valid save file')); } };
    r.onerror = () => rej(new Error('Could not read the file'));
    r.readAsText(file);
  });
}
