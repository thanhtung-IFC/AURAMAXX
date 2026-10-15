// The user's five reference faces, ordered from Rookie to Champion.
const portraits = Object.freeze({
  rookie: { file: "rookie", style: "pixel" },
  casual: { file: "casual", style: "pixel" },
  skilled: { file: "skilled", style: "cutout" },
  elite: { file: "elite", style: "cutout" },
  champion: { file: "champion", style: "cutout" },
});

export function renderBotPortrait(bot, compact = false) {
  const portrait = portraits[bot.id];
  const level = Object.keys(portraits).indexOf(bot.id) + 1;
  const classes = `arena-bot-avatar${compact ? " arena-bot-avatar-compact" : ""}`;
  const fallback = '<svg aria-hidden="true"><use href="#i-face"/></svg>';
  if (!portrait) return `<span class="${classes}">${fallback}</span>`;
  const base = `assets/arena-bots/${portrait.file}`;
  return `<span class="${classes}" data-level="${level}" data-portrait-style="${portrait.style}"><img data-arena-portrait src="${base}-160.webp" srcset="${base}-160.webp 160w, ${base}-320.webp 320w" sizes="${compact ? "48px" : "(max-width: 760px) 144px, 140px"}" width="320" height="320" alt="" loading="lazy" decoding="async">${fallback}</span>`;
}

document.addEventListener("error", event => {
  if (event.target instanceof HTMLImageElement && event.target.hasAttribute("data-arena-portrait")) event.target.dataset.failed = "true";
}, true);
