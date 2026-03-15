/**
 * Wardrobe & Hairstyles — standalone SillyTavern extension
 *
 * Manages clothing outfits and hairstyles for characters/users.
 * - Upload reference images for outfits and hairstyles
 * - Generate text descriptions via Vision API
 * - Inject descriptions into the text model's prompt
 * - Expose a global API (window.SillyWardrobeAPI) so that image-generation
 *   extensions can read active items and attach reference images.
 *
 * v1.0.0
 */

const MODULE_NAME = 'silly_wardrobe';

// ============================================================
// LOGGING
// ============================================================

function swLog(level, ...args) {
    const tag = '[SillyWardrobe]';
    if (level === 'ERROR') console.error(tag, ...args);
    else if (level === 'WARN') console.warn(tag, ...args);
    else console.log(tag, ...args);
}

// ============================================================
// DEFAULT SETTINGS
// ============================================================

const defaultSettings = Object.freeze({
    // --- Vision API ---
    visionEndpoint: '',
    visionApiKey: '',
    visionModel: '',
    wardrobeDescPrompt:
        'Describe this clothing outfit in detail for a character in a roleplay. ' +
        'Focus on: type of garment, color, material/texture, style, notable features, accessories. ' +
        'Be concise but thorough (2-4 sentences). Write in English.',
    hairstyleDescPrompt:
        'Describe this hairstyle shape and form for a character in a roleplay. ' +
        'Focus on: hair length, texture, style (straight/curly/wavy), cut, bangs, volume, layers, ' +
        'accessories (ribbons, clips, pins), and overall silhouette. Do NOT mention or describe ' +
        'hair color — only describe the shape and styling. Be concise but thorough (2-3 sentences). Write in English.',

    // --- Wardrobe ---
    wardrobeItems: [],
    activeWardrobeChar: null,
    activeWardrobeUser: null,
    injectWardrobeToChat: true,

    // --- Hairstyles ---
    hairstyleItems: [],
    activeHairstyleChar: null,
    activeHairstyleUser: null,
    injectHairstyleToChat: true,

    // --- Shared ---
    injectionDepth: 1,
    collapsedSections: {},
});

// ============================================================
// SETTINGS HELPERS
// ============================================================

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = defaultSettings[key];
    }
    // Migrate items without description
    for (const key of ['wardrobeItems', 'hairstyleItems']) {
        for (const item of (s[key] || [])) {
            if (!Object.hasOwn(item, 'description')) item.description = '';
        }
    }
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ============================================================
// OUTFIT SYSTEM (generic for wardrobe & hairstyle)
// ============================================================

const OUTFIT_SYSTEMS = {
    wardrobe: {
        itemsKey: 'wardrobeItems',
        activeCharKey: 'activeWardrobeChar',
        activeUserKey: 'activeWardrobeUser',
        idPrefix: 'sw_ward_',
        defaultName: 'Outfit',
        injectEnabledKey: 'injectWardrobeToChat',
        descPromptKey: 'wardrobeDescPrompt',
        injectionKey: MODULE_NAME + '_wardrobe',
        wearingVerb: 'is currently wearing',
    },
    hairstyle: {
        itemsKey: 'hairstyleItems',
        activeCharKey: 'activeHairstyleChar',
        activeUserKey: 'activeHairstyleUser',
        idPrefix: 'sw_hair_',
        defaultName: 'Hairstyle',
        injectEnabledKey: 'injectHairstyleToChat',
        descPromptKey: 'hairstyleDescPrompt',
        injectionKey: MODULE_NAME + '_hairstyle',
        wearingVerb: "'s current hairstyle:",
    },
};

function addOutfitItem(sys, name, imageData, target = 'char') {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const item = {
        id: cfg.idPrefix + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        name: name || cfg.defaultName,
        imageData,
        description: '',
        target,
        createdAt: Date.now(),
    };
    s[cfg.itemsKey].push(item);
    saveSettings();
    return item;
}

function removeOutfitItem(sys, itemId) {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    if (s[cfg.activeCharKey] === itemId) s[cfg.activeCharKey] = null;
    if (s[cfg.activeUserKey] === itemId) s[cfg.activeUserKey] = null;
    s[cfg.itemsKey] = s[cfg.itemsKey].filter(i => i.id !== itemId);
    saveSettings();
    updateOutfitInjection(sys);
}

function setActiveOutfit(sys, itemId, target) {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const key = target === 'char' ? cfg.activeCharKey : cfg.activeUserKey;
    s[key] = s[key] === itemId ? null : itemId;
    saveSettings();
    updateOutfitInjection(sys);
}

function getActiveOutfitItem(sys, target) {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const activeId = s[target === 'char' ? cfg.activeCharKey : cfg.activeUserKey];
    return activeId ? (s[cfg.itemsKey].find(i => i.id === activeId) || null) : null;
}

function updateOutfitItemDescription(sys, itemId, description) {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const item = s[cfg.itemsKey].find(i => i.id === itemId);
    if (item) {
        item.description = description;
        saveSettings();
        updateOutfitInjection(sys);
        swLog('INFO', `Updated ${sys} description for "${item.name}"`);
    }
}

// ============================================================
// PROMPT INJECTION
// ============================================================

function updateOutfitInjection(sys) {
    try {
        const cfg = OUTFIT_SYSTEMS[sys];
        const ctx = SillyTavern.getContext();
        const s = getSettings();

        if (!s[cfg.injectEnabledKey]) {
            if (typeof ctx.setExtensionPrompt === 'function') {
                ctx.setExtensionPrompt(cfg.injectionKey, '', 0, 0);
            }
            return;
        }

        const parts = [];
        const targets = [
            ['char', () => ctx.characters?.[ctx.characterId]?.name || 'Character'],
            ['user', () => ctx.name1 || 'User'],
        ];

        for (const [target, getName] of targets) {
            const item = getActiveOutfitItem(sys, target);
            if (item?.description) {
                const name = getName();
                if (sys === 'wardrobe') {
                    parts.push(`[${name} is currently wearing: ${item.description}]`);
                } else {
                    parts.push(`[${name}'s current hairstyle shape (hair color unchanged): ${item.description}]`);
                }
            }
        }

        const depth = s.injectionDepth || 1;
        if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(cfg.injectionKey, parts.join('\n'), 1, depth);
        }
    } catch (err) {
        swLog('ERROR', `Error updating ${sys} injection:`, err);
    }
}

function updateAllInjections() {
    updateOutfitInjection('wardrobe');
    updateOutfitInjection('hairstyle');
}

// ============================================================
// VISION API — MODEL FETCHING
// ============================================================

async function fetchVisionModels() {
    const s = getSettings();
    if (!s.visionEndpoint || !s.visionApiKey) return [];
    const url = `${s.visionEndpoint.replace(/\/$/, '')}/v1/models`;
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${s.visionApiKey}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Filter out obvious image-generation-only models
        const IMAGE_KW = [
            'dall-e', 'midjourney', 'stable-diffusion', 'sdxl', 'flux', 'imagen',
            'seedream', 'hidream', 'dreamshaper', 'ideogram', 'nano-banana',
            'gpt-image', 'wanx',
        ];
        return (data.data || [])
            .filter(m => !IMAGE_KW.some(kw => m.id.toLowerCase().includes(kw)))
            .map(m => m.id);
    } catch (err) {
        toastr.error(`Ошибка загрузки моделей: ${err.message}`, 'Wardrobe');
        return [];
    }
}

// ============================================================
// VISION API — DESCRIPTION GENERATION
// ============================================================

async function generateOutfitDescription(sys, itemId) {
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const item = s[cfg.itemsKey].find(i => i.id === itemId);
    if (!item?.imageData) throw new Error('Нет данных изображения');
    if (!s.visionEndpoint) throw new Error('Не настроен эндпоинт Vision API');
    if (!s.visionApiKey) throw new Error('Не настроен API ключ');
    if (!s.visionModel) throw new Error('Не выбрана модель');

    const promptText = s[cfg.descPromptKey] || defaultSettings[cfg.descPromptKey];

    const response = await fetch(`${s.visionEndpoint.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${s.visionApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: s.visionModel,
            max_tokens: 500,
            temperature: 0.3,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: { url: `data:image/png;base64,${item.imageData}` },
                        },
                        { type: 'text', text: promptText },
                    ],
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`API ошибка (${response.status}): ${await response.text().catch(() => '?')}`);
    }

    const result = await response.json();
    const description = result.choices?.[0]?.message?.content?.trim();
    if (!description) throw new Error('Модель вернула пустой ответ');

    swLog('INFO', `Generated ${sys} description for "${item.name}": ${description.substring(0, 100)}...`);
    return description;
}

// ============================================================
// IMAGE RESIZE
// ============================================================

function resizeImageBase64(base64, maxSize = 512) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width <= maxSize && height <= maxSize) { resolve(base64); return; }
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => resolve(base64);
        img.src = `data:image/png;base64,${base64}`;
    });
}

// ============================================================
// PUBLIC API  (window.SillyWardrobeAPI)
// ============================================================

/**
 * This API is consumed by image-generation extensions (e.g. SillyImages).
 *
 * Usage from another extension:
 *   const api = window.SillyWardrobeAPI;
 *   if (api?.isReady()) {
 *       const charOutfit = api.getActiveWardrobe('char');
 *       // charOutfit = { id, name, imageData, description } | null
 *   }
 */
const SillyWardrobeAPI = {
    /** Check if the extension is loaded and ready */
    isReady() {
        return true;
    },

    /**
     * Get active wardrobe (clothing) item for target.
     * @param {'char'|'user'} target
     * @returns {{ id: string, name: string, imageData: string, description: string } | null}
     */
    getActiveWardrobe(target) {
        return getActiveOutfitItem('wardrobe', target);
    },

    /**
     * Get active hairstyle item for target.
     * @param {'char'|'user'} target
     * @returns {{ id: string, name: string, imageData: string, description: string } | null}
     */
    getActiveHairstyle(target) {
        return getActiveOutfitItem('hairstyle', target);
    },

    /**
     * Get all items for a system.
     * @param {'wardrobe'|'hairstyle'} sys
     * @returns {Array}
     */
    getAllItems(sys) {
        const cfg = OUTFIT_SYSTEMS[sys];
        if (!cfg) return [];
        return getSettings()[cfg.itemsKey] || [];
    },

    /**
     * Build reference images array for image generation.
     * Returns objects with { base64, label, name } ready to use.
     * @returns {Array<{ base64: string, label: string, name: string }>}
     */
    collectReferences() {
        const ctx = SillyTavern.getContext();
        const charName = ctx.characters?.[ctx.characterId]?.name || 'Character';
        const userName = ctx.name1 || 'User';
        const refs = [];

        // Wardrobe
        const cw = getActiveOutfitItem('wardrobe', 'char');
        if (cw?.imageData) {
            let label = `Clothing reference for ${charName}: "${cw.name}". ${charName} MUST be wearing exactly this outfit.`;
            if (cw.description) label += ` Outfit description: ${cw.description}`;
            refs.push({ base64: cw.imageData, label, name: `${charName}'s outfit` });
        }
        const uw = getActiveOutfitItem('wardrobe', 'user');
        if (uw?.imageData) {
            let label = `Clothing reference for ${userName}: "${uw.name}". ${userName} MUST be wearing exactly this outfit.`;
            if (uw.description) label += ` Outfit description: ${uw.description}`;
            refs.push({ base64: uw.imageData, label, name: `${userName}'s outfit` });
        }

        // Hairstyle
        const ch = getActiveOutfitItem('hairstyle', 'char');
        if (ch?.imageData) {
            let label = `Hairstyle SHAPE reference for ${charName}: "${ch.name}". Copy ONLY the hair shape, length, and styling. Do NOT copy hair color — keep ${charName}'s ORIGINAL hair color.`;
            if (ch.description) label += ` Hairstyle description: ${ch.description}`;
            refs.push({ base64: ch.imageData, label, name: `${charName}'s hairstyle` });
        }
        const uh = getActiveOutfitItem('hairstyle', 'user');
        if (uh?.imageData) {
            let label = `Hairstyle SHAPE reference for ${userName}: "${uh.name}". Copy ONLY the hair shape, length, and styling. Do NOT copy hair color — keep ${userName}'s ORIGINAL hair color.`;
            if (uh.description) label += ` Hairstyle description: ${uh.description}`;
            refs.push({ base64: uh.imageData, label, name: `${userName}'s hairstyle` });
        }

        return refs;
    },

    /**
     * Build prompt enhancement parts (clothing/hairstyle overrides for image gen prompt).
     * Returns an array of strings to inject into the image generation prompt.
     * @returns {string[]}
     */
    getPromptParts() {
        const ctx = SillyTavern.getContext();
        const charName = ctx.characters?.[ctx.characterId]?.name || 'Character';
        const userName = ctx.name1 || 'User';
        const parts = [];

        const cw = getActiveOutfitItem('wardrobe', 'char');
        if (cw) {
            let s = `[CLOTHING OVERRIDE for ${charName}: The character MUST be wearing the outfit shown in the clothing reference image "${cw.name}". Ignore any other clothing descriptions — use ONLY the referenced outfit.`;
            if (cw.description) s += ` Detailed outfit description: ${cw.description}`;
            s += ']';
            parts.push(s);
        }
        const uw = getActiveOutfitItem('wardrobe', 'user');
        if (uw) {
            let s = `[CLOTHING OVERRIDE for ${userName}: This person MUST be wearing the outfit shown in the clothing reference image "${uw.name}". Ignore any other clothing descriptions — use ONLY the referenced outfit.`;
            if (uw.description) s += ` Detailed outfit description: ${uw.description}`;
            s += ']';
            parts.push(s);
        }

        const ch = getActiveOutfitItem('hairstyle', 'char');
        if (ch) {
            let s = `[HAIRSTYLE SHAPE OVERRIDE for ${charName}: Copy ONLY the hair shape, length, cut, and styling from the hairstyle reference image "${ch.name}". CRITICAL: Do NOT change ${charName}'s hair color — preserve the ORIGINAL hair color. Only the hairstyle shape/form changes, not the color.`;
            if (ch.description) s += ` Hairstyle description: ${ch.description}`;
            s += ']';
            parts.push(s);
        }
        const uh = getActiveOutfitItem('hairstyle', 'user');
        if (uh) {
            let s = `[HAIRSTYLE SHAPE OVERRIDE for ${userName}: Copy ONLY the hair shape, length, cut, and styling from the hairstyle reference image "${uh.name}". CRITICAL: Do NOT change ${userName}'s hair color — preserve the ORIGINAL hair color. Only the hairstyle shape/form changes, not the color.`;
            if (uh.description) s += ` Hairstyle description: ${uh.description}`;
            s += ']';
            parts.push(s);
        }

        return parts;
    },
};

window.SillyWardrobeAPI = SillyWardrobeAPI;

// ============================================================
// COLLAPSIBLE SECTIONS
// ============================================================

function isSectionCollapsed(id) {
    return getSettings().collapsedSections?.[id] === true;
}

function toggleSectionCollapsed(id) {
    const s = getSettings();
    if (!s.collapsedSections) s.collapsedSections = {};
    s.collapsedSections[id] = !s.collapsedSections[id];
    saveSettings();
}

function sectionHtml(id, icon, title, body) {
    const collapsed = isSectionCollapsed(id);
    return `
        <div class="sw-section" data-sw-section-id="${id}">
            <div class="sw-section-header" data-sw-toggle="${id}">
                <span class="sw-section-icon">${icon}</span>
                <span class="sw-section-title">${title}</span>
                <i class="fa-solid fa-chevron-down sw-chevron ${collapsed ? 'sw-collapsed' : ''}"></i>
            </div>
            <div class="sw-section-body ${collapsed ? 'sw-hidden' : ''}">
                ${body}
            </div>
        </div>`;
}

// ============================================================
// OUTFIT GRID RENDERING
// ============================================================

const OUTFIT_UI = {
    wardrobe: {
        prefix: 'sw_ward',
        icon: 'fa-shirt',
        emptyText: 'Нет одежды. Нажмите + чтобы добавить.',
        deleteMsg: 'Одежда удалена',
        placeholder: 'Описание одежды (вручную или через AI)...',
        saveMsg: 'Описание сохранено',
        clearMsg: 'Описание очищено',
        genMsg: 'Описание сгенерировано',
    },
    hairstyle: {
        prefix: 'sw_hair',
        icon: 'fa-scissors',
        emptyText: 'Нет причёсок. Нажмите + чтобы добавить.',
        deleteMsg: 'Причёска удалена',
        placeholder: 'Описание причёски (вручную или через AI)...',
        saveMsg: 'Описание причёски сохранено',
        clearMsg: 'Описание причёски очищено',
        genMsg: 'Описание причёски сгенерировано',
    },
};

function renderOutfitGrid(sys, target) {
    const ui = OUTFIT_UI[sys];
    const cfg = OUTFIT_SYSTEMS[sys];
    const s = getSettings();
    const container = document.getElementById(`${ui.prefix}_${target}`);
    if (!container) return;

    const items = s[cfg.itemsKey].filter(i => i.target === target);
    const activeId = s[target === 'char' ? cfg.activeCharKey : cfg.activeUserKey];

    if (items.length === 0) {
        container.innerHTML = `<div class="sw-empty">${ui.emptyText}</div>`;
        renderDescPanel(sys, target);
        return;
    }

    container.innerHTML = items
        .map(
            item => `
        <div class="sw-card ${item.id === activeId ? 'sw-card-active' : ''}"
             data-sw-id="${item.id}" data-sw-target="${target}" data-sw-sys="${sys}">
            <img src="data:image/png;base64,${item.imageData}" class="sw-card-img" alt="${item.name}">
            <div class="sw-card-overlay">
                <span class="sw-card-name" title="${item.name}">${item.name}</span>
                <div class="sw-card-actions">
                    ${item.description ? '<i class="fa-solid fa-file-lines sw-has-desc" title="Есть описание"></i>' : ''}
                    <i class="fa-solid fa-trash sw-card-del" data-sw-del="${item.id}" title="Удалить"></i>
                </div>
            </div>
            ${item.id === activeId ? '<div class="sw-check"><i class="fa-solid fa-check"></i></div>' : ''}
        </div>`,
        )
        .join('');

    // Bind card clicks
    container.querySelectorAll('.sw-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.sw-card-del')) return;
            setActiveOutfit(card.dataset.swSys, card.dataset.swId, card.dataset.swTarget);
            renderOutfitGrid(card.dataset.swSys, card.dataset.swTarget);
        });
    });
    container.querySelectorAll('[data-sw-del]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            removeOutfitItem(sys, btn.dataset.swDel);
            renderOutfitGrid(sys, target);
            toastr.info(ui.deleteMsg, 'Wardrobe');
        });
    });

    renderDescPanel(sys, target);
}

function renderDescPanel(sys, target) {
    const ui = OUTFIT_UI[sys];
    const panelId = `${ui.prefix}_desc_${target}`;
    let panel = document.getElementById(panelId);
    if (!panel) {
        const grid = document.getElementById(`${ui.prefix}_${target}`);
        if (!grid) return;
        panel = document.createElement('div');
        panel.id = panelId;
        panel.className = 'sw-desc-panel';
        grid.parentNode.insertBefore(panel, grid.nextSibling);
    }

    const activeItem = getActiveOutfitItem(sys, target);
    if (!activeItem) {
        panel.innerHTML = '';
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="sw-desc-header">
            <i class="fa-solid ${ui.icon}"></i>
            <span>Описание: <b>${activeItem.name}</b></span>
        </div>
        <textarea class="text_pole sw-desc-textarea" rows="3"
                  placeholder="${ui.placeholder}"
                  data-sw-item="${activeItem.id}">${activeItem.description || ''}</textarea>
        <div class="sw-desc-actions">
            <div class="menu_button sw-desc-gen" data-sw-item="${activeItem.id}" title="Сгенерировать через Vision AI">
                <i class="fa-solid fa-robot"></i> Сгенерировать
            </div>
            <div class="menu_button sw-desc-save" data-sw-item="${activeItem.id}">
                <i class="fa-solid fa-floppy-disk"></i> Сохранить
            </div>
            <div class="menu_button sw-desc-clear" data-sw-item="${activeItem.id}">
                <i class="fa-solid fa-eraser"></i>
            </div>
        </div>
        <div class="sw-desc-status" id="${ui.prefix}_status_${target}" style="display:none;"></div>
    `;

    const textarea = panel.querySelector('.sw-desc-textarea');

    textarea?.addEventListener('blur', () => {
        updateOutfitItemDescription(sys, textarea.dataset.swItem, textarea.value);
    });

    panel.querySelector('.sw-desc-save')?.addEventListener('click', () => {
        updateOutfitItemDescription(sys, textarea.dataset.swItem, textarea.value);
        toastr.success(ui.saveMsg, 'Wardrobe');
        renderOutfitGrid(sys, target);
    });

    panel.querySelector('.sw-desc-clear')?.addEventListener('click', () => {
        textarea.value = '';
        updateOutfitItemDescription(sys, textarea.dataset.swItem, '');
        toastr.info(ui.clearMsg, 'Wardrobe');
        renderOutfitGrid(sys, target);
    });

    panel.querySelector('.sw-desc-gen')?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        const itemId = btn.dataset.swItem;
        const statusEl = document.getElementById(`${ui.prefix}_status_${target}`);
        btn.classList.add('disabled');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Генерация...';
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = 'Отправка картинки vision-модели...';
            statusEl.className = 'sw-desc-status';
        }
        try {
            const desc = await generateOutfitDescription(sys, itemId);
            textarea.value = desc;
            updateOutfitItemDescription(sys, itemId, desc);
            if (statusEl) {
                statusEl.textContent = 'Описание сгенерировано!';
                statusEl.classList.add('sw-status-ok');
            }
            toastr.success(ui.genMsg, 'Wardrobe');
            renderOutfitGrid(sys, target);
        } catch (err) {
            swLog('ERROR', `Generate ${sys} description failed:`, err);
            if (statusEl) {
                statusEl.textContent = `Ошибка: ${err.message}`;
                statusEl.classList.add('sw-status-err');
            }
            toastr.error(`Ошибка: ${err.message}`, 'Wardrobe');
        } finally {
            btn.classList.remove('disabled');
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> Сгенерировать';
            setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 5000);
        }
    });
}

// ============================================================
// SETTINGS UI
// ============================================================

function createSettingsUI() {
    const s = getSettings();
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    // --- Vision API section ---
    const visionApiHtml = `
        <p class="hint">Настройте текстовую/vision модель для генерации описаний одежды и причёсок по картинке. Используется OpenAI-совместимый Chat Completions API с поддержкой image_url.</p>
        <div class="flex-row">
            <label for="sw_vision_endpoint">Эндпоинт</label>
            <input type="text" id="sw_vision_endpoint" class="text_pole flex1"
                   value="${s.visionEndpoint || ''}" placeholder="https://api.example.com">
        </div>
        <div class="flex-row">
            <label for="sw_vision_api_key">API ключ</label>
            <input type="password" id="sw_vision_api_key" class="text_pole flex1"
                   value="${s.visionApiKey || ''}">
            <div id="sw_key_toggle" class="menu_button sw-key-toggle" title="Показать/Скрыть">
                <i class="fa-solid fa-eye"></i>
            </div>
        </div>
        <div class="flex-row">
            <label for="sw_vision_model">Модель</label>
            <select id="sw_vision_model" class="flex1">
                ${s.visionModel
                    ? `<option value="${s.visionModel}" selected>${s.visionModel}</option>`
                    : '<option value="">-- Выберите --</option>'}
            </select>
            <div id="sw_refresh_models" class="menu_button sw-refresh" title="Обновить">
                <i class="fa-solid fa-sync"></i>
            </div>
        </div>
    `;

    // --- Prompts section ---
    const promptsHtml = `
        <div class="flex-col" style="margin-bottom:8px;">
            <label for="sw_ward_prompt">Промпт для описания одежды</label>
            <textarea id="sw_ward_prompt" class="text_pole" rows="3"
                      placeholder="Describe this clothing outfit...">${s.wardrobeDescPrompt || defaultSettings.wardrobeDescPrompt}</textarea>
        </div>
        <div class="flex-col">
            <label for="sw_hair_prompt">Промпт для описания причёски</label>
            <textarea id="sw_hair_prompt" class="text_pole" rows="3"
                      placeholder="Describe this hairstyle...">${s.hairstyleDescPrompt || defaultSettings.hairstyleDescPrompt}</textarea>
        </div>
    `;

    // --- Injection section ---
    const injectionHtml = `
        <label class="checkbox_label">
            <input type="checkbox" id="sw_inject_ward" ${s.injectWardrobeToChat ? 'checked' : ''}>
            <span>Инжектить описание одежды в промпт текстовой модели</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="sw_inject_hair" ${s.injectHairstyleToChat ? 'checked' : ''}>
            <span>Инжектить описание причёски в промпт текстовой модели</span>
        </label>
        <div class="flex-row" style="margin-top:5px;">
            <label for="sw_injection_depth">Глубина инжекта</label>
            <input type="number" id="sw_injection_depth" class="text_pole flex1"
                   value="${s.injectionDepth || 1}" min="0" max="10">
        </div>
    `;

    // --- Wardrobe section ---
    const wardrobeHtml = `
        <h5 style="margin:8px 0 4px;">Одежда персонажа</h5>
        <div id="sw_ward_char" class="sw-grid"></div>
        <div class="sw-add-row">
            <input type="text" id="sw_ward_char_name" class="text_pole flex1" placeholder="Название наряда">
            <input type="file" id="sw_ward_char_file" accept="image/*" style="display:none;">
            <div id="sw_ward_char_add" class="menu_button" title="Добавить одежду"><i class="fa-solid fa-plus"></i> Добавить</div>
        </div>
        <h5 style="margin:14px 0 4px;">Одежда юзера</h5>
        <div id="sw_ward_user" class="sw-grid"></div>
        <div class="sw-add-row">
            <input type="text" id="sw_ward_user_name" class="text_pole flex1" placeholder="Название наряда">
            <input type="file" id="sw_ward_user_file" accept="image/*" style="display:none;">
            <div id="sw_ward_user_add" class="menu_button" title="Добавить одежду"><i class="fa-solid fa-plus"></i> Добавить</div>
        </div>
    `;

    // --- Hairstyle section ---
    const hairstyleHtml = `
        <h5 style="margin:8px 0 4px;">Причёска персонажа</h5>
        <div id="sw_hair_char" class="sw-grid"></div>
        <div class="sw-add-row">
            <input type="text" id="sw_hair_char_name" class="text_pole flex1" placeholder="Название причёски">
            <input type="file" id="sw_hair_char_file" accept="image/*" style="display:none;">
            <div id="sw_hair_char_add" class="menu_button" title="Добавить причёску"><i class="fa-solid fa-plus"></i> Добавить</div>
        </div>
        <h5 style="margin:14px 0 4px;">Причёска юзера</h5>
        <div id="sw_hair_user" class="sw-grid"></div>
        <div class="sw-add-row">
            <input type="text" id="sw_hair_user_name" class="text_pole flex1" placeholder="Название причёски">
            <input type="file" id="sw_hair_user_file" accept="image/*" style="display:none;">
            <div id="sw_hair_user_add" class="menu_button" title="Добавить причёску"><i class="fa-solid fa-plus"></i> Добавить</div>
        </div>
    `;

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>👗 Гардероб и причёски</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="sw-settings">
                    ${sectionHtml('sw_api', '🔌', 'Vision API', visionApiHtml)}
                    ${sectionHtml('sw_prompts', '✍️', 'Промпты описаний', promptsHtml)}
                    ${sectionHtml('sw_inject', '💉', 'Инжекция в чат', injectionHtml)}
                    ${sectionHtml('sw_wardrobe', '👗', 'Гардероб (одежда)', wardrobeHtml)}
                    ${sectionHtml('sw_hairstyles', '💇', 'Причёски', hairstyleHtml)}
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);

    // Bind collapsible toggles
    document.querySelectorAll('[data-sw-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            const id = header.dataset.swToggle;
            toggleSectionCollapsed(id);
            const section = header.closest('.sw-section');
            section.querySelector('.sw-section-body').classList.toggle('sw-hidden');
            section.querySelector('.sw-chevron').classList.toggle('sw-collapsed');
        });
    });

    bindEvents();
    renderOutfitGrid('wardrobe', 'char');
    renderOutfitGrid('wardrobe', 'user');
    renderOutfitGrid('hairstyle', 'char');
    renderOutfitGrid('hairstyle', 'user');
}

// ============================================================
// EVENT BINDINGS
// ============================================================

function bindEvents() {
    const s = getSettings();

    // Vision API
    document.getElementById('sw_vision_endpoint')?.addEventListener('input', e => {
        s.visionEndpoint = e.target.value; saveSettings();
    });
    document.getElementById('sw_vision_api_key')?.addEventListener('input', e => {
        s.visionApiKey = e.target.value; saveSettings();
    });
    document.getElementById('sw_key_toggle')?.addEventListener('click', () => {
        const inp = document.getElementById('sw_vision_api_key');
        const ico = document.querySelector('#sw_key_toggle i');
        if (inp.type === 'password') { inp.type = 'text'; ico.classList.replace('fa-eye', 'fa-eye-slash'); }
        else { inp.type = 'password'; ico.classList.replace('fa-eye-slash', 'fa-eye'); }
    });
    document.getElementById('sw_vision_model')?.addEventListener('change', e => {
        s.visionModel = e.target.value; saveSettings();
    });
    document.getElementById('sw_refresh_models')?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        btn.classList.add('loading');
        try {
            const models = await fetchVisionModels();
            const sel = document.getElementById('sw_vision_model');
            sel.innerHTML = '<option value="">-- Выберите --</option>';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m; opt.selected = m === s.visionModel;
                sel.appendChild(opt);
            }
            toastr.success(`Найдено моделей: ${models.length}`, 'Wardrobe');
        } catch (err) {
            toastr.error('Ошибка загрузки моделей', 'Wardrobe');
        } finally {
            btn.classList.remove('loading');
        }
    });

    // Prompts
    document.getElementById('sw_ward_prompt')?.addEventListener('input', e => {
        s.wardrobeDescPrompt = e.target.value; saveSettings();
    });
    document.getElementById('sw_hair_prompt')?.addEventListener('input', e => {
        s.hairstyleDescPrompt = e.target.value; saveSettings();
    });

    // Injection
    document.getElementById('sw_inject_ward')?.addEventListener('change', e => {
        s.injectWardrobeToChat = e.target.checked; saveSettings();
        updateOutfitInjection('wardrobe');
    });
    document.getElementById('sw_inject_hair')?.addEventListener('change', e => {
        s.injectHairstyleToChat = e.target.checked; saveSettings();
        updateOutfitInjection('hairstyle');
    });
    document.getElementById('sw_injection_depth')?.addEventListener('input', e => {
        s.injectionDepth = parseInt(e.target.value) || 1; saveSettings();
        updateAllInjections();
    });

    // Outfit add buttons
    const bindAdd = (sys, target) => {
        const ui = OUTFIT_UI[sys];
        const cfg = OUTFIT_SYSTEMS[sys];
        const addBtn = document.getElementById(`${ui.prefix}_${target}_add`);
        const fileInput = document.getElementById(`${ui.prefix}_${target}_file`);
        const nameInput = document.getElementById(`${ui.prefix}_${target}_name`);
        addBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onloadend = async () => {
                const resized = await resizeImageBase64(reader.result.split(',')[1], 512);
                const name = nameInput?.value?.trim() || file.name.replace(/\.[^.]+$/, '') || cfg.defaultName;
                addOutfitItem(sys, name, resized, target);
                if (nameInput) nameInput.value = '';
                fileInput.value = '';
                renderOutfitGrid(sys, target);
                toastr.success(`${cfg.defaultName} "${name}" добавлен(а)`, 'Wardrobe');
            };
            reader.readAsDataURL(file);
        });
    };
    for (const sys of ['wardrobe', 'hairstyle']) {
        bindAdd(sys, 'char');
        bindAdd(sys, 'user');
    }
}

// ============================================================
// INIT
// ============================================================

(function init() {
    const ctx = SillyTavern.getContext();
    getSettings();

    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
        createSettingsUI();
        updateAllInjections();
        swLog('INFO', 'Wardrobe & Hairstyles v1.0.0 loaded');
    });

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        setTimeout(() => updateAllInjections(), 100);
    });

    swLog('INFO', 'Wardrobe & Hairstyles v1.0.0 initialized');
})();
