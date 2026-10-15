# Face Arena bot portraits

Order: Rookie → Casual → Skilled → Elite → Champion, matching the five user attachments from left to right.

- Rookie and Casual: original uploaded pixel faces, with no generative changes to the final assets. Nearest-neighbor web thumbnail preparation and lossless WebP encoding preserve the block edges.
- Skilled, Elite and Champion: cutouts prepared with the built-in image_gen tool; original cartoon/photo style and facial expression retained. Transparent alpha preserved in WebP.
- Each final portrait is available at 160 × 160 and 320 × 320. Responsive srcset selects a suitable asset; CSS supplies the same frame and theme background for every level.
- No external image hosts or runtime image-generation API is used by the website.

## Image preparation prompts

### rookie

Use case: identity-preserve. Asset type: square BOT avatar for the AURAMAXX Face Arena website. Input images: the five user-attached images in their original order. EDIT TARGET: image 1 only, the brown pixel-art face with black open mouth, red tongue and cyan drool. Images 2–5 are context only, do not blend them. Make a clean square avatar preserving the target's exact distinctive Minecraft-style block shapes, face colors, asymmetrical cyan drool, black mouth, red tongue, dark brown hair and white rectangular eyes. Preserve the intentionally crude pixel-art style and sharp nearest-neighbor block edges. This is avatar preparation, not a redesign: do not beautify, do not add facial details, do not smooth pixels. Tight face-only square crop, filled edge to edge exactly as the target, no extra margins, no typography, no badges, no border, no decorative background. Output a single opaque square avatar.

### casual

Use case: identity-preserve. Asset type: square BOT avatar for AURAMAXX Face Arena. Input images: the five user-attached images in their original order. EDIT TARGET: image 2 only, the straight-on classic brown-haired pixel-art face with white eyes, purple pupils and dark brown square beard. Images 1 and 3–5 are context only. Prepare a crisp square avatar of image 2, retaining the original 8-by-8 pixel-grid face design, exact neutral expression, purple eyes, brown hair, skin blocks, square nose and beard. Keep the original pixel-art medium and hard square edges; do not smooth, repaint realistically, beautify, redesign, invent details or add lighting effects. Face fills the square edge to edge, no added padding, no lettering, no frame, no badge. Output one opaque square avatar.

### skilled

Use case: background-extraction / identity-preserve. Asset type: BOT portrait for AURAMAXX Face Arena. Input images: the five user-attached images in their original order. EDIT TARGET: image 3 only, the cartoon Minecraft man with a tilted cuboid head, dark brown hair, purple eyes, expressive angular brows, defined cheek lines and turquoise shirt. Other inputs are context only. Remove the outdoor game scenery and create a tight square avatar cutout of this exact character's full head plus a small amount of upper neck and turquoise shirt at the bottom. Preserve the same facial identity, angular tilted head, hair outline, purple eyes, line art, original expression, original colors and cartoon medium; do not redraw into a different character or turn it into a photo. Keep hair and chin uncut; the head should fill approximately 88–92% of the square, centered for a website profile tile. Clean precise silhouette edges. Real transparent alpha background, no scene, no glow, no border, no text, no badge.

### elite

Use case: background-extraction / identity-preserve. Asset type: square BOT portrait for AURAMAXX Face Arena. Input images: the five user-attached images in their original order. EDIT TARGET: image 4 only, the photographic man with swept brown hair, a slight closed-mouth smile, formal white shirt and black bow tie. Other inputs are context only. Prepare a tight square head-and-upper-neck cutout of that exact person from the photo. Remove only the dark background and excess lower torso. Preserve the original face, smile, eye direction, age, hair, skin texture, facial proportions and photographic realism. Do not beautify, change facial features, smooth skin or change the expression. Gently balance the very dark facial exposure for readability at small avatar size while keeping the original warm cinematic photo colors. The entire hair outline and chin must fit; the head fills approximately 85–90% of the square, a little collar may remain at the bottom. Precise natural silhouette and real transparent alpha background. No vignette, border, glow, text or badge.

### champion

Use case: background-extraction / identity-preserve. Asset type: square BOT portrait for AURAMAXX Face Arena. Input images: the five user-attached images in their original order. EDIT TARGET: image 5 only, the grayscale photographic muscular man with short swept-back hair and a full dark beard looking to the left. Other inputs are context only. Make a tight square avatar cutout of this exact person's full head, beard and upper neck with a small amount of shoulder at the bottom. Remove the flat gray background and most of the chest. Preserve the original three-quarter head angle, smile, eye direction, precise face identity, hair and beard texture, monochrome photographic style and original facial proportions. Do not beautify, enhance muscles, make the jaw larger, alter the smile or invent details. Entire hair and beard outline must remain inside the canvas; center the visible head to fill about 85–90% of the square. Clean natural cutout edges, actual transparent alpha background, no colored treatment, no extra lighting, no border, glow, text or badge.

