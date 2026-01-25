import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

const HARDCODED_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
// const HARDCODED_API_KEY = "nyaa"; // CORS修复：注释掉 Key，避免触发复杂跨域检查
const DEFAULT_MODEL = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];

// 试听文本
const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";

// ===== 初始化设置 =====
const SETTING_KEY = "quote_tts";

async function loadSettings() {
    if (!extension_settings[SETTING_KEY]) {
        extension_settings[SETTING_KEY] = { characterMap: {} };
    }
}

// ===== 核心逻辑：UI 注入 =====
jQuery(async () => {
    await loadSettings();

    // 循环检查容器，修复面板消失问题
    const checkInterval = setInterval(async () => {
        const $settingsContainer = $("#extensions_settings");
        
        if ($settingsContainer.length > 0 && $(".quote-tts-extension-settings").length === 0) {
            clearInterval(checkInterval);
            
            try {
                const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
                $settingsContainer.append(settingsHtml);

                $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
                initChatListener();
                
                console.log("[Quote TTS] 面板加载成功");
            } catch (error) {
                console.error(`[Quote TTS] 加载 settings.html 失败: ${error}`);
            }
        }
    }, 500);
});

// ===== 逻辑功能实现 =====

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // --- 1. 获取角色列表 ---
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

    // --- 2. 渲染列表项 ---
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
                    <span class="quote-tts-preview-btn interactable" title="试听当前选择的音色">🔊</span>
                    <select class="text_pole">
                        ${optionsHtml}
                    </select>
                </div>
            </div>
        `);

        $row.find('select').on('change', function() {
            const newVal = $(this).val();
            updateQuoteTTSChar(charName, newVal);
        });

        $row.find('.quote-tts-preview-btn').on('click', async function(e) {
            e.stopPropagation();
            const currentSelectedVoice = $row.find('select').val();
            await playTTS(this, PREVIEW_TEXT, currentSelectedVoice); // 复用统一的播放函数
        });

        $container.append($row);
    });

    if (typeof toastr !== 'undefined') toastr.success(`已加载 ${participants.size} 名角色`);
}

function updateQuoteTTSChar(charName, voice) {
    if (!extension_settings[SETTING_KEY]) extension_settings[SETTING_KEY] = { characterMap: {} };
    extension_settings[SETTING_KEY].characterMap[charName] = voice;
    saveSettingsDebounced();
}

// ===== 核心功能：统一播放函数 (含 CORS 修复) =====

async function playTTS(btnElement, text, voice) {
    const $btn = $(btnElement);
    if ($btn.hasClass('loading')) return;

    const originalIcon = $btn.html();
    $btn.addClass('loading').html('⏳');

    try {
        // 构建 Headers
        const headers = {
            'Content-Type': 'application/json'
        };
        // CORS 修复：如果需要 Authorization 再取消注释，但通常 dummy key 会导致 CORS 失败
        // headers['Authorization'] = `Bearer ${HARDCODED_API_KEY}`;

        const response = await fetch(HARDCODED_API_URL, {
            method: 'POST',
            mode: 'cors', // 明确指定 CORS
            credentials: 'omit', // 修复：不发送 Cookie，降低 CORS 门槛
            headers: headers,
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                input: text,
                voice: voice,
                response_format: "mp3"
            })
        });

        if (!response.ok) {
            // 尝试读取错误信息
            const errText = await response.text();
            throw new Error(`API ${response.status}: ${errText}`);
        }
        
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html(originalIcon); // 恢复原图标
            URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
            console.error("Audio playback error");
            $btn.removeClass('loading').html('❌');
            setTimeout(() => $btn.html(originalIcon), 2000);
        };
        
        await audio.play();

    } catch (e) {
        console.error("TTS Error:", e);
        if (typeof toastr !== 'undefined') toastr.error(`播放失败: ${e.message || "网络/CORS错误"}`);
        $btn.removeClass('loading').html('❌');
        setTimeout(() => $btn.html(originalIcon), 2000);
    }
}

// 暴露给 Window 供 HTML onclick 使用 (聊天记录中的按钮)
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation();
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    
    // 调用统一的播放函数
    await playTTS(btnElement, text, voice);
};


// ===== 核心功能：聊天监听 =====

function initChatListener() {
    const observer = new MutationObserver(() => processAllMessages());
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }
    processAllMessages();
}

function processAllMessages() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        if ($msgBlock.attr('data-quote-tts-processed')) return;
        
        $msgBlock.attr('data-quote-tts-processed', 'true');
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        if (!content || content.trim().length === 0) return match;
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);
        
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) $element.html(newHtml);
}
