// Lựa chọn chỉ tồn tại trong bộ nhớ tab; không lưu hồ sơ khuôn mặt hoặc vào storage.
let selectedBotId = null;
let selectedBotProfile = null;

export function selectArenaBot(botId, profile = null) {
  selectedBotId = botId;
  selectedBotProfile = profile;
  window.dispatchEvent(new CustomEvent("auramaxx:bot-selected"));
}

export function getSelectedArenaBot() {
  return selectedBotId;
}

export function getSelectedArenaBotProfile() {
  return selectedBotId ? selectedBotProfile || { id: selectedBotId, name: selectedBotId } : null;
}

export function clearSelectedArenaBot() {
  selectedBotId = null;
  selectedBotProfile = null;
  window.dispatchEvent(new CustomEvent("auramaxx:bot-selected"));
}
