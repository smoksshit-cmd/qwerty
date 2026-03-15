# Integration Guide: Patching SillyImages to use Wardrobe & Hairstyles extension

This document describes the changes needed in the SillyImages (Inline Image Gen) extension
to use `window.SillyWardrobeAPI` instead of its built-in wardrobe/hairstyle system.

---

## 1. In `collectReferenceImages()` — replace built-in wardrobe/hairstyle references

Find the section that starts with `// Wardrobe clothing references` and ends with the 
`userHairstyleItem` block. Replace it with:

```javascript
    // ---- External Wardrobe & Hairstyle references (via SillyWardrobeAPI) ----
    if (window.SillyWardrobeAPI?.isReady()) {
        const extRefs = window.SillyWardrobeAPI.collectReferences();
        for (const ref of extRefs) {
            references.push(ref);
        }
        iigLog('INFO', `Added ${extRefs.length} references from SillyWardrobeAPI`);
    }
```

## 2. In `buildEnhancedPrompt()` — replace built-in wardrobe/hairstyle prompt parts

Find the sections for `// Wardrobe clothing instructions` and `// v2.4: Hairstyle instructions`.
Replace both blocks with:

```javascript
    // ---- External Wardrobe & Hairstyle prompt parts (via SillyWardrobeAPI) ----
    if (window.SillyWardrobeAPI?.isReady()) {
        const extParts = window.SillyWardrobeAPI.getPromptParts();
        promptParts.push(...extParts);
    }
```

## 3. Remove built-in wardrobe/hairstyle settings from `createSettingsUI()`

You can delete these sections from the settings UI (or leave them and they just won't
be used if you applied patches #1 and #2):

- `wardrobeSectionContent` (the `👗 Гардероб` collapsible)
- `wardrobeDescApiSectionContent` (the `🤖 Описание одежды` collapsible) 
- `hairstyleSectionContent` (the `💇 Причёски` collapsible)

And the corresponding event bindings.

## 4. Remove built-in wardrobe/hairstyle default settings

From `defaultSettings`, you can remove (or just leave unused):
- `wardrobeItems`, `activeWardrobeChar`, `activeWardrobeUser`
- `hairstyleItems`, `activeHairstyleChar`, `activeHairstyleUser`
- `wardrobeDescEndpoint`, `wardrobeDescApiKey`, `wardrobeDescModel`
- `injectWardrobeToChat`, `injectHairstyleToChat`
- `wardrobeInjectionDepth`
- `wardrobeDescPrompt`, `hairstyleDescPrompt`

## 5. Remove injection calls

Remove or skip calls to:
- `updateWardrobeInjection()`
- `updateHairstyleInjection()`

The standalone extension handles its own injection.

---

That's it! The Wardrobe & Hairstyles extension will handle all outfit/hairstyle management,
vision API description generation, prompt injection, and reference image collection.
SillyImages just needs to call the API to get references and prompt parts.
