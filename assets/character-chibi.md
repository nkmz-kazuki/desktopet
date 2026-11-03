# Q 版角色素材

原角色设计：上善无形；DeepSeek 女仆形象二次设计：ZipZipPipe。

- 原作展示：[ZipZipPipe《大AI和小AI们》](https://www.bilibili.com/video/BV1tE9XBbErS/)，约 5 秒处。
- 参考截帧：[shuaizenge/ai-girls](https://github.com/shuaizenge/ai-girls/blob/main/characters/deepseek/chibi/zipzippipe-BV1tE9XBbErS-05s.png)，720×1280，SHA-256：`cbcd4b58b2115b8dbc7ece8271026841928be7ac594705693357ade8e8baacef`。
- [原作者许可说明](https://www.bilibili.com/opus/1247156596114456581)：CC BY-NC-SA 4.0，署名、非商业使用、相同方式共享。[许可全文](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.zh-hans)。
- `character-chibi.png` 与 `character-chibi-happy.png` 为按用户要求，用内置 imagegen 制作的透明背景衍生素材；该素材沿用 CC BY-NC-SA 4.0。不是作者直接提供的透明底原稿。应用代码与其他素材的许可不因此改变。
- 两张均为 1024×1536。正常表情和眯眼笑共用画布、身体姿势与显示尺寸，不额外施加水平偏移。

## 生成方式与提示词

使用内置 imagegen 编辑模式，无额外图像 API Key。

第一步，以完整参考截帧为编辑目标，制作睁眼透明角色：

> Use case: background-extraction. This image is the exact edit target: a blue-haired DeepSeek character with whale-themed maid outfit, from ZipZipPipe's chibi reference. Prepare her as an application sprite. Remove ONLY the off-white background to real transparent alpha, including gaps between arms, hair locks, legs and tail. Preserve the entire existing character drawing precisely: open blue eyes, the exact face, mouth, head shape, hair, maid clothing, embroidered skirt, shoes, both hands, whale tail, colors and lighting. Do not redesign, re-pose or redraw. Keep ALL character parts including the top antenna hair and shoes. Fit the unchanged cutout centered on a 1024x1536 transparent canvas, keep its original aspect ratio and give a small consistent transparent margin on all sides (roughly 24 pixels below soles); do not stretch. No text, watermark, background, ground plane or shadow on the transparent area. Output a single high quality transparent PNG, which will be paired with a second exactly aligned eyes-only edit.

第二步，以第一步的透明图为目标，修改眼部：

> Use case: precise-object-edit. Edit target: the supplied transparent 1024x1536 blue-haired whale-maid sprite. PRIMARY REQUEST: modify ONLY the two eyes from open blue eyes to happily closed smiling eyes (眯眼笑): curved, expressive anime eyelids with lashes. Preserve the existing smile/mouth exactly. STRICT INVARIANTS: keep every pixel outside the two small eye regions unchanged, including eyebrows, blush, nose, face outline, bangs and all hair, headband, hands/fingers, body pose, clothes, hem embroidery, tail, legs, shoes, colors, lighting, and all transparent alpha outside the character. Same exact 1024x1536 canvas, same scale, x/y position and silhouette, no crop, zoom, horizontal shift or redrawing. This image is an alternate animation frame and must align perfectly with the reference when layered. Keep real transparent alpha background. Do not add glow, shadows, backdrop, text, stickers or symbols. Return a single transparent PNG.
