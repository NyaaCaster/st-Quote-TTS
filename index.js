import { saveSettingsDebounced, getContext, extension_settings } from "../../../extensions.js";

// --- 硬编码配置 (用户不可见) ---
const HARDCODED_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
const HARDCODED_API_KEY = "nyaa";
const DEFAULT_MODEL = "tts-1-hd";

const AVAILABLE_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunyangNeural"
];

// 扩展内部标识 (用于存储角色音色配置)
const EXTENSION_NAME = "quote_tts";

// 默认设置 (仅保留角色映射，不再存储API信息)
const defaultSettings = {
    characterMap: {} // 存储 { "角色名": "VoiceName" }
};

// --- 初始化与加载 ---

jQuery(async () => {
    // 1. 初始化设置对象
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = defaultSettings;
    }

    // 2. 注入设置面板 (尝试解决面板不显示的问题)
    // 使用间隔检查确保 #extensions_settings 容器已存在
    const interval = setInterval(() => {
        if ($("#extensions_settings").length > 0) {
            clearInterval(interval);
            injectSettingsPanel();
        }
    }, 500);

    // 3. 监听聊天记录变化
    // 监听 #chat 容器，涵盖页面加载和新消息
    const observer = new MutationObserver(onChatChanged);
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }

    // 4. 初始处理当前页面消息 (防止监听器遗漏初始内容)
    setTimeout(processAllMessages, 2000);
});

// --- UI 注入逻辑 ---

function injectSettingsPanel() {
    // 防止重复注入
    if ($('#quote_tts_settings_container').length > 0) return;

    const html = `
        <div id="quote_tts_settings_container" class="extension_settings_block">
            <h4>Quote TTS</h4>
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header" id="quote_tts_drawer_toggle">
                    <b>点击展开设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" id="quote_tts_drawer_content" style="display:none;">
                    <div style="margin-bottom: 10px; font-size: 0.9em; opacity: 0.8;">
                        <i>API 已内置配置，无需手动设置。</i>
                    </div>
                    <hr>
                    <button id="quote_tts_refresh_chars" class="menu_button">🔄 读取当前角色列表</button>
                    <div id="quote_tts_char_list" style="margin-top: 10px;"></div>
                </div>
            </div>
        </div>
    `;

    $("#extensions_settings").append(html);

    // 绑定事件
    $('#quote_tts_drawer_toggle').click(() => {
        $('#quote_tts_drawer_content').slideToggle();
        $('#quote_tts_drawer_toggle .inline-drawer-icon').toggleClass('down').toggleClass('up');
    });

    $('#quote_tts_refresh_chars').click(renderCharacterSettings);
}


// --- 核心逻辑：消息处理 ---

function onChatChanged(mutations) {
    processAllMessages();
}

function processAllMessages() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 如果已经处理过，跳过
        if ($msgBlock.attr('data-quote-tts-processed')) return;
        
        // 标记为已处理
        $msgBlock.attr('data-quote-tts-processed', 'true');

        // 获取角色名 (向上查找最近的 mes_block)
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();

    // 正则匹配引号："" “” ‘’ 「」 『』
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        if (!content || content.trim().length === 0) return match;
        
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);

        // 按钮调用 window.playQuoteTTS
        return `${openQuote}${content}${closeQuote}<button class="quote-tts-btn" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</button>`;
    });

    if (html !== newHtml) {
        $element.html(newHtml);
    }
}

// --- 核心逻辑：播放控制 ---

window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    
    // 获取用户设置的角色音色
    const settings = extension_settings[EXTENSION_NAME];
    let voice = settings.characterMap[charName];
    
    // 默认回退逻辑
    if (!voice) {
        voice = AVAILABLE_VOICES[0];
    }

    // UI: 加载状态
    const btn = $(btnElement);
    const originalIcon = btn.html();
    btn.addClass('loading').html('⏳');

    try {
        const response = await fetch(HARDCODED_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${HARDCODED_API_KEY}`
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                input: text,
                voice: voice,
                response_format: "mp3"
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            btn.removeClass('loading').html(originalIcon);
            URL.revokeObjectURL(audioUrl); // 释放内存
        };

        audio.onerror = () => {
            console.error("Audio playback error");
            btn.removeClass('loading').html('❌');
        };

        await audio.play();

    } catch (error) {
        console.error('TTS Error:', error);
        // 如果有 toastr 库则提示，没有则仅控制台
        if (typeof toastr !== 'undefined') {
            toastr.error('TTS播放失败，请检查网络。');
        }
        btn.removeClass('loading').html('❌');
        setTimeout(() => btn.html(originalIcon), 2000);
    }
};

// --- 设置面板逻辑：角色列表 ---

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // 尝试获取全局角色列表
    const allChars = window.characters || [];
    
    if (allChars.length === 0) {
        $container.html('<p>未找到角色数据，请确保已加载角色。</p>');
        return;
    }

    allChars.forEach(char => {
        const charName = char.name;
        const savedVoice = extension_settings[EXTENSION_NAME].characterMap[charName] || AVAILABLE_VOICES[0];

        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        const row = `
            <div class="quote-tts-settings-row">
                <span title="${charName}">${charName}</span>
                <select onchange="window.updateQuoteTTSChar('${charName.replace(/'/g, "\\'")}', this.value)">
                    ${optionsHtml}
                </select>
            </div>
        `;
        $container.append(row);
    });
}

// 保存设置
window.updateQuoteTTSChar = function(charName, voice) {
    if (!extension_settings[EXTENSION_NAME].characterMap) {
        extension_settings[EXTENSION_NAME].characterMap = {};
    }
    extension_settings[EXTENSION_NAME].characterMap[charName] = voice;
    saveSettingsDebounced();
};
