import { extension_settings, getContext } from "../../../extensions.js";
// 引入 getRequestHeaders (鉴权) 和 eventSource (事件监听)
import { saveSettingsDebounced, getRequestHeaders, eventSource, event_types } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

// Edge-TTS 配置
const TARGET_ENDPOINT = "http://h.hony-wen.com:5050/v1/audio/speech";
const API_KEY = "nyaa";
const MODEL_ID = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];

// 试听文本
const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";

// ST 后端代理接口
const ST_PROXY_URL = "/api/openai/custom/generate-voice";

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

    // 1. 注入设置面板 (循环检查确保容器存在)
    const checkInterval = setInterval(async () => {
        const $settingsContainer = $("#extensions_settings");
        
        if ($settingsContainer.length > 0 && $(".quote-tts-extension-settings").length === 0) {
            clearInterval(checkInterval);
            try {
                const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
                $settingsContainer.append(settingsHtml);
                $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
                console.log("[Quote TTS] 面板加载成功");
            } catch (error) {
                console.error(`[Quote TTS] 加载 settings.html 失败: ${error}`);
            }
        }
    }, 500);

    // 2. 启动聊天处理监听器
    initChatListener();
});

// ===== 逻辑功能实现：设置面板 =====

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
            await playTTS(this, PREVIEW_TEXT, currentSelectedVoice);
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

// ===== 核心功能：统一播放函数 (ST 后端代理) =====

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
                api_key: API_KEY, 
                token: API_KEY 
            })
        });

        if (!response.ok) {
            let errorMsg = response.statusText;
            try { errorMsg = await response.text(); } catch(e){}
            throw new Error(`Proxy Error ${response.status}: ${errorMsg}`);
        }
        
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html(originalIcon);
            URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
            console.error("Audio playback error");
            $btn.removeClass('loading').html('❌');
            setTimeout(() => $btn.html(originalIcon), 2000);
        };
        
        await audio.play();

    } catch (e) {
        console.error("TTS Proxy Error:", e);
        if (typeof toastr !== 'undefined') toastr.error(`TTS 失败: ${e.message}`);
        $btn.removeClass('loading').html('❌');
        setTimeout(() => $btn.html(originalIcon), 2000);
    }
}

// 暴露给 Window 供聊天气泡中的按钮调用
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation();
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    
    await playTTS(btnElement, text, voice);
};


// ===== 核心功能：聊天记录扫描与注入 (修复版) =====

function initChatListener() {
    // 1. 监听 DOM 变化 (用于实时生成的消息)
    // 这是一个激进的观察者，它会捕捉所有变动
    const observer = new MutationObserver(() => {
        // 使用 debounce 或直接执行，这里直接执行因为 injectPlayButtons 具有幂等性
        processAllMessages();
    });
    
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }

    // 2. 监听 SillyTavern 官方事件 (确保生成完成后必定执行一次)
    // MESSAGE_RECEIVED: 生成完成
    // CHAT_CHANGED: 切换聊天/加载历史
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, () => processAllMessages());
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(processAllMessages, 500); // 延迟一点等待 DOM 渲染
        });
    }

    // 3. 立即执行一次
    processAllMessages();
}

function processAllMessages() {
    // 遍历所有消息块
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 关键修复：不再检查 data-quote-tts-processed 属性
        // 允许重复扫描，因为 injectPlayButtons 内部逻辑会防止重复添加按钮

        // 获取角色名
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();
    
    // 正则表达式升级：
    // 1. 匹配引号内容： ([“"‘「『])([\s\S]*?)([”"’」』])
    // 2. 负向先行断言 (Negative Lookahead): (?!\s*<span class="quote-tts-btn)
    //    意思是：只有当引号后面 **没有** 紧跟着我们的播放按钮时，才进行匹配。
    //    这保证了代码可以反复运行而不会添加重复按钮。
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])(?!\s*<span class="quote-tts-btn)/g;

    let hasChanges = false;
    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        // 过滤空内容或纯空白
        if (!content || content.trim().length === 0) return match;
        
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);
        
        hasChanges = true;
        
        // 返回：引号内容 + 按钮
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    // 只有当真正发生替换时才更新 DOM，避免不必要的重绘
    if (hasChanges) {
        $element.html(newHtml);
    }
}
