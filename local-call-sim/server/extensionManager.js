let currentExtension = '966';

export function getActiveExtension() {
  return currentExtension;
}

export function generateExtension() {
  // Generate random 3-digit extension between 100 and 999 (or common patterns like 966, 007, 123)
  const presets = ['966', '007', '123', '415', '808', '555', '302', '911', '777', '212'];
  // 50% chance to pick a memorable preset or generate random 3 digits
  if (Math.random() > 0.5) {
    const choice = presets[Math.floor(Math.random() * presets.length)];
    if (choice !== currentExtension) {
      currentExtension = choice;
      return currentExtension;
    }
  }
  const randomNum = Math.floor(100 + Math.random() * 900);
  currentExtension = String(randomNum);
  return currentExtension;
}

export function validateExtension(ext) {
  if (!ext) return false;
  const cleaned = String(ext).trim();
  return cleaned === currentExtension;
}

