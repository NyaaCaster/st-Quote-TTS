import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

// Edge-TTS 目标配置
const TARGET_ENDPOINT = "http://h.hony-wen.com:5050/v1/audio/speech";
const API_KEY = "nyaa"; // 鉴权 Key
const MODEL_ID = "tts-1-hd";

// ST 后端代理接口 (解决 CORS/Fetch 报错的关键)
const ST_PROXY_URL = "/api/openai/custom/generate-voice";

const AVAILABLE_VOICES = [
    "zh-CN-XiaoxiaoNeural", 
    "zh-CN-XiaoyiNeural", 
    "zh-CN-liaoning-XiaobeiNeural", 
    "zh-CN-shaanxi-XiaoniNeural", 
    "zh-HK-HiuGaaiNeural", 
    "zh-HK-HiuMaanNeural", 
    "zh-TW-HsiaoChenNeural", 
    "zh-TW-HsiaoYuNeural", 
    "zh-CN-YunjianNeural", 
    "zh-CN-YunxiNeural", 
    "zh-CN-YunxiaNeural", 
    "zh-CN-YunyangNeural", 
    "zh-HK-WanLungNeural", 
    "zh-TW-YunJheNeural"
];

const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";
const SETTING_KEY = "quote_tts";

// ===== 初始化 =====
jQuery(async () => {
    // 1. 初始化配置
    if (!extension_settings[SETTING_KEY]) {
        extension_settings[SETTING_KEY] = { characterMap: {} };
    }

    // 2. 注入设置面板
    const checkInterval = setInterval(async () => {
        const $settingsContainer = $("#extensions_settings");
        if ($settingsContainer.length > 0 && $(".quote-tts-extension-settings").length === 0) {
            clearInterval(checkInterval);
            try {
                const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
                $settingsContainer.append(settingsHtml);
                $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
                console.log("[Quote TTS] 设置面板加载成功");
            } catch (e) {
                console.error("[Quote TTS] 加载 HTML 失败", e);
            }
        }
    }, 1000);

    // 3. 注册事件监听
    initSafeEventListeners();
});

// ===== 核心逻辑：安全的事件监听 =====
function initSafeEventListeners() {
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
            setTimeout(() => processChatSafe(), 200);
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(() => processChatSafe(), 1000);
        });
    }
    setTimeout(() => processChatSafe(), 2000);
}

// ===== 核心逻辑：消息处理 =====
function processChatSafe() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        if ($msgBlock.closest('.mes_block').find('.typing_indicator').length > 0) return;
        if ($msgBlock.find('.quote-tts-btn').length > 0) return;

        const $parentBlock = $msgBlock.closest('.mes_block');
        const blockSenderName = $parentBlock.find('.name_text').text().trim();
        injectPlayButtons($msgBlock, blockSenderName);
    });
}

function injectPlayButtons($element, blockSenderName) {
    let html = $element.html();
    
    // 正则表达式：支持“人名: 引号”模式，同时屏蔽英文双引号
    // Group 1: 人名(可选), Group 2: 引号内容
    const smartQuoteRegex = /(?:(?:^|>|[\n\r])\s*([^:<>&"'\n\r]{1,30}?):\s*)?([“‘「『][\s\S]*?[”’」』])(?!\s*<span class="quote-tts-btn)/g;

    let hasChanges = false;
    const newHtml = html.replace(smartQuoteRegex, (match, inlineName, content) => {
        if (!content || content.trim().length === 0) return match;
        if (content.includes('quote-tts-btn')) return match;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const plainText = tempDiv.textContent || tempDiv.innerText || "";
        
        // 优先使用捕获的人名，否则使用消息发送者
        const targetCharName = (inlineName && inlineName.trim()) ? inlineName.trim() : blockSenderName;
        
        const safeText = encodeURIComponent(plainText);
        const safeCharName = encodeURIComponent(targetCharName);
        
        hasChanges = true;
        return `${match}<span class="quote-tts-btn interactable" title="播放 (${targetCharName})" onclick="window.playQuoteTTS(this, '${safeText}', '${safeCharName}')">🔊</span>`;
    });

    if (hasChanges) {
        $element.html(newHtml);
    }
}

// ===== 逻辑功能：设置面板 =====
function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    const context = getContext();
    const participants = new Set();

    if (context.name2) participants.add(context.name2);
    else participants.add("User");

    if (context.characterId !== undefined && context.characterId !== null) {
        const currentCharacter = window.characters && window.characters[context.characterId];
        if (currentCharacter && currentCharacter.name) participants.add(currentCharacter.name);
    }

    // 扫描消息块和文本内容中的角色名
    $('#chat .name_text').each(function() {
        const name = $(this).text().trim();
        if (name) participants.add(name);
    });
    $('#chat .mes_text').each(function() {
        const text = $(this).text();
        const inlineNameScanRegex = /(?:^|\n)\s*([^:\n\r]{1,30}?):\s*[“‘「『]/g;
        let m;
        while ((m = inlineNameScanRegex.exec(text)) !== null) {
            if (m[1]) participants.add(m[1].trim());
        }
    });

    if (participants.size === 0) {
        $container.html('<div style="padding:15px; text-align:center;">未检测到角色。</div>');
        return;
    }

    Array.from(participants).sort().forEach(charName => {
        const savedVoice = extension_settings[SETTING_KEY].characterMap[charName] || AVAILABLE_VOICES[0];
        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        const $row = $(`
            <div class="quote-tts-settings-row">
                <span class="char-name" title="${charName}">${charName}</span>
                <div class="quote-tts-controls">
                    <span class="quote-tts-preview-btn interactable" title="试听">🔊</span>
                    <select class="text_pole">${optionsHtml}</select>
                </div>
            </div>
        `);

        $row.find('select').on('change', function() {
            updateQuoteTTSChar(charName, $(this).val());
        });

        $row.find('.quote-tts-preview-btn').on('click', async function(e) {
            e.stopPropagation();
            await playTTS(this, PREVIEW_TEXT, $row.find('select').val());
        });

        $container.append($row);
    });
}

function updateQuoteTTSChar(charName, voice) {
    if (!extension_settings[SETTING_KEY]) extension_settings[SETTING_KEY] = { characterMap: {} };
    extension_settings[SETTING_KEY].characterMap[charName] = voice;
    saveSettingsDebounced();
}

// ===== 核心功能：代理播放 (解决 CORS 和 401) =====
async function playTTS(btnElement, text, voice) {
    const $btn = $(btnElement);
    if ($btn.hasClass('loading')) return;

    const originalIcon = $btn.html();
    $btn.addClass('loading').html('⏳');

    try {
        // 使用 ST 后端代理转发请求
        const response = await fetch(ST_PROXY_URL, {
            method: 'POST',
            headers: getRequestHeaders(), 
            body: JSON.stringify({
                provider_endpoint: TARGET_ENDPOINT, 
                model: MODEL_ID,
                input: text,
                voice: voice,
                response_format: 'mp3',
                // 必须在 body 中传递鉴权信息给 ST 后端
                api_key: API_KEY,
                token: API_KEY 
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ST Proxy ${response.status}: ${errText}`);
        }
        
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html(originalIcon);
            URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
            $btn.removeClass('loading').html('❌');
            setTimeout(() => $btn.html(originalIcon), 2000);
        };
        
        await audio.play();

    } catch (e) {
        console.error("TTS Error:", e);
        if (typeof toastr !== 'undefined') toastr.error(`TTS Error: ${e.message}`);
        $btn.removeClass('loading').html('❌');
        setTimeout(() => $btn.html(originalIcon), 2000);
    }
}

// 暴露给 Window
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation();
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    
    await playTTS(btnElement, text, voice);
};
