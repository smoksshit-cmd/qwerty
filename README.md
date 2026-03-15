# 👗 Wardrobe & Hairstyles — SillyTavern Extension

Standalone extension for managing character outfits (clothing) and hairstyles with Vision AI description generation.

Works as a companion to image-generation extensions (like [SillyImages](https://github.com/user/sillyimages)) but is **fully independent** — you can use it on its own for text-model prompt injection.

## Features

- **Wardrobe management** — upload clothing reference images for characters and users
- **Hairstyle management** — upload hairstyle reference images
- **Vision AI descriptions** — auto-generate text descriptions from images via any OpenAI-compatible vision model
- **Prompt injection** — inject active outfit/hairstyle descriptions into the text model's context
- **Public API** — exposes `window.SillyWardrobeAPI` for other extensions to read active items and reference images

## Installation

### Via SillyTavern Extension Installer
1. Open SillyTavern → Extensions → Install Extension
2. Paste this repo URL: `https://github.com/user/silly-wardrobe`
3. Click Install

### Manual
1. Navigate to `SillyTavern/data/default-user/extensions/`
2. Clone this repo: `git clone https://github.com/user/silly-wardrobe`
3. Restart SillyTavern

## Configuration

### Vision API Setup
The extension uses an OpenAI-compatible `/v1/chat/completions` endpoint with vision (image_url) support to generate text descriptions of uploaded images.

1. Open **Extensions → 👗 Гардероб и причёски → Vision API**
2. Enter your endpoint URL (e.g. `https://api.openai.com`, or any compatible proxy)
3. Enter your API key
4. Click refresh and select a vision model (e.g. `gpt-4o`, `claude-3.5-sonnet`, etc.)

### Adding Outfits / Hairstyles
1. Open the **Гардероб (одежда)** or **Причёски** section
2. Type a name and click **+ Добавить** to upload an image
3. Click the card to make it active (green border = active)
4. Optionally click **Сгенерировать** to auto-describe the image via Vision AI, or type a description manually

### Prompt Injection
When **Инжектить описание** is enabled, the active outfit/hairstyle descriptions are injected into the text model's prompt at the configured depth. This way the AI knows what your character is wearing even without image generation.

## API for Image Generation Extensions

Other extensions can access active wardrobe/hairstyle data:

```javascript
const api = window.SillyWardrobeAPI;

if (api?.isReady()) {
    // Get active items
    const charOutfit = api.getActiveWardrobe('char');
    // → { id, name, imageData (base64), description } | null
    
    const charHair = api.getActiveHairstyle('char');
    const userOutfit = api.getActiveWardrobe('user');
    const userHair = api.getActiveHairstyle('user');

    // Get reference images ready for image generation
    const refs = api.collectReferences();
    // → [{ base64, label, name }, ...]

    // Get prompt enhancement parts
    const promptParts = api.getPromptParts();
    // → ["[CLOTHING OVERRIDE for CharName: ...]", ...]
}
```

### Integration with SillyImages (Inline Image Gen)

To use this extension with SillyImages, modify the `collectReferenceImages()` and `buildEnhancedPrompt()` functions in SillyImages to check for the API:

```javascript
// In collectReferenceImages():
if (window.SillyWardrobeAPI?.isReady()) {
    const wardrobeRefs = window.SillyWardrobeAPI.collectReferences();
    references.push(...wardrobeRefs);
}

// In buildEnhancedPrompt():
if (window.SillyWardrobeAPI?.isReady()) {
    const parts = window.SillyWardrobeAPI.getPromptParts();
    promptParts.push(...parts);
}
```

## API Reference

| Method | Returns | Description |
|--------|---------|-------------|
| `isReady()` | `boolean` | Check if extension is loaded |
| `getActiveWardrobe(target)` | `item \| null` | Get active clothing item (`target`: `'char'` or `'user'`) |
| `getActiveHairstyle(target)` | `item \| null` | Get active hairstyle item |
| `getAllItems(sys)` | `array` | Get all items (`sys`: `'wardrobe'` or `'hairstyle'`) |
| `collectReferences()` | `array` | Get reference images array for image gen |
| `getPromptParts()` | `string[]` | Get prompt override strings for image gen |

## License

MIT
