import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const TARGET_ENDPOINT = "http://h.hony-wen.com:5050/v1/audio/speech";
const API_KEY = "nyaa";
const MODEL_ID = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];
const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";
const ST_PROXY_URL = "/api/openai/custom/generate-voice";
const SETTING_KEY = "quote_tts";

// ===== 初始化 =====
jQuery(async () => {
    // 1. 初始化配置
    if (!extension_settings[SETTING_KEY]) {
        extension_settings[SETTING_KEY] = { characterMap: {} };
    }

    // 2. 注入设置面板 (循环检查确保容器存在)
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

    // 3. 注册事件监听 (安全模式，防止卡死)
    initSafeEventListeners();
});

// ===== 核心逻辑：安全的事件监听 =====
function initSafeEventListeners() {
    if (eventSource) {
        // 当一条新消息完全生成完毕时触发
        eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
            setTimeout(() => processChatSafe(), 200);
        });

        // 当切换聊天卡片或加载历史记录时触发
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(() => processChatSafe(), 1000);
        });
    }

    // 页面初次加载时执行一次
    setTimeout(() => processChatSafe(), 2000);
}

// ===== 核心逻辑：消息处理 =====
function processChatSafe() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 1. 检查是否正在打字 (流式生成中不处理)
        if ($msgBlock.closest('.mes_block').find('.typing_indicator').length > 0) return;

        // 2. 检查是否已经包含我们的按钮 (防止重复)
        if ($msgBlock.find('.quote-tts-btn').length > 0) return;

        // 3. 执行注入
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();
    
    // 正则表达式修改：
    // 已移除英文双引号 "
    // 保留：
    // 1. 中文双引号 “”
    // 2. 中文单引号 ‘’
    // 3. 日文引号 「」 『』
    const quoteRegex = /([“‘「『])([\s\S]*?)([”’」』])/g;

    let hasChanges = false;
    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        // 过滤空内容
        if (!content || content.trim().length === 0) return match;
        
        // 防御性检查
        if (content.includes('quote-tts-btn')) return match;

        // 提取纯文本用于 TTS
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const plainText = tempDiv.textContent || tempDiv.innerText || "";
        
        const safeText = encodeURIComponent(plainText);
        const safeCharName = encodeURIComponent(charName);
        
        hasChanges = true;
        
        // 生成带按钮的 HTML
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeText}', '${safeCharName}')">🔊</span>`;
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

    $('#chat .name_text').each(function() {
        const name = $(this).text().trim();
        if (name) participants.add(name);
    });

    if (participants.size === 0) {
        $container.html('<div style="padding:15px; text-align:center;">未检测到角色，请先加载对话。</div>');
        return;
    }

    participants.forEach(charName => {
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

// ===== 核心功能：播放 (代理) =====
async function playTTS(btnElement, text, voice) {
    const $btn = $(btnElement);
    if ($btn.hasClass('loading')) return;

    const originalIcon = $btn.html();
    $btn.addClass('loading').html('⏳');

    try {
        const response = await fetch(ST_PROXY_URL, {
            method: 'POST',
            headers: getRequestHeaders(), 
            body: JSON.stringify({
                provider_endpoint: TARGET_ENDPOINT, 
                model: MODEL_ID,
                input: text,
                voice: voice,
                response_format: 'mp3',
                api_key: API_KEY
            })
        });

        if (!response.ok) throw new Error(`Proxy ${response.status}`);
        
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
