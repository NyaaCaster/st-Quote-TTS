import { saveSettingsDebounced, extension_settings } from "../../../extensions.js";

// ===== 硬编码配置 (用户不可见) =====
const HARDCODED_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
const HARDCODED_API_KEY = "nyaa";
const DEFAULT_MODEL = "tts-1-hd";

const AVAILABLE_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunyangNeural"
];

// 扩展内部标识
const EXTENSION_NAME = "quote_tts";

// ===== HTML 模板 (参考 SillyTavern 标准 Drawer 结构) =====
// 我们直接将 HTML 写在这里，避免用户需要额外上传 HTML 文件导致路径错误
const SETTINGS_HTML = `
<div class="quote-tts-settings-block">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Quote TTS</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        
        <div class="inline-drawer-content" style="display:none;">
            <div style="margin-bottom: 10px; font-size: 0.9em; opacity: 0.8; padding: 5px;">
                <i class="fa-solid fa-circle-info"></i> 
                API 已预配置，无需手动设置。请下方为角色绑定音色。
            </div>
            
            <div class="flex-container alignitemscenter" style="justify-content: space-between; margin-bottom: 10px;">
                <strong>角色音色配置</strong>
                <div id="quote_tts_refresh_btn" class="menu_button interactable" title="读取当前对话中的角色">
                    <i class="fa-solid fa-rotate"></i> 刷新列表
                </div>
            </div>

            <div id="quote_tts_char_list" class="quote-tts-list-container">
                <!-- 角色列表将渲染在这里 -->
                <div style="text-align:center; padding: 10px; opacity: 0.5;">点击刷新按钮加载角色</div>
            </div>
        </div>
    </div>
</div>
`;

// ===== 初始化逻辑 =====

function ensureInitialized() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {
            characterMap: {}
        };
        saveSettingsDebounced();
    }
}

// 注入设置面板
function initSettings() {
    // 1. 确保设置对象存在
    ensureInitialized();

    // 2. 找到扩展设置容器
    const settingsContainer = jQuery("#extensions_settings");
    if (settingsContainer.length === 0) {
        console.error("Quote TTS: 未找到 #extensions_settings 容器，尝试稍后重试");
        setTimeout(initSettings, 500);
        return;
    }

    // 3. 避免重复注入
    if (jQuery(".quote-tts-settings-block").length > 0) return;

    // 4. 追加 HTML
    settingsContainer.append(SETTINGS_HTML);

    // 5. 绑定 Drawer 折叠/展开事件 (参考 style.css 中的动画)
    const toggleBtn = settingsContainer.find(".quote-tts-settings-block .inline-drawer-toggle");
    const contentDiv = settingsContainer.find(".quote-tts-settings-block .inline-drawer-content");
    const icon = toggleBtn.find(".inline-drawer-icon");

    toggleBtn.on("click", () => {
        contentDiv.slideToggle(200);
        if (icon.hasClass("down")) {
            icon.removeClass("down").addClass("up");
        } else {
            icon.removeClass("up").addClass("down");
        }
    });

    // 6. 绑定刷新按钮事件
    jQuery("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
}

// ===== 核心逻辑：聊天处理 =====

function initChatListener() {
    // 监听聊天区域变化
    const observer = new MutationObserver((mutations) => {
        processAllMessages();
    });
    
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }
    
    // 初始执行一次
    processAllMessages();
}

function processAllMessages() {
    jQuery('.mes_text').each(function() {
        const $msgBlock = jQuery(this);
        
        // 防止重复处理
        if ($msgBlock.attr('data-quote-tts-processed')) return;
        $msgBlock.attr('data-quote-tts-processed', 'true');

        // 获取角色名
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();
    // 匹配引号
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        if (!content || content.trim().length === 0) return match;
        
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);

        // 注意：这里调用 window.playQuoteTTS，需要将其挂载到 window
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放 TTS" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) {
        $element.html(newHtml);
    }
}

// ===== 播放逻辑 (挂载到 Window) =====

window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    // 防止冒泡 (虽然 span onclick 不容易冒泡到消息编辑，但保险起见)
    if (event) event.stopPropagation();

    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    
    // 读取配置
    const settings = extension_settings[EXTENSION_NAME] || { characterMap: {} };
    let voice = settings.characterMap[charName];
    
    if (!voice) voice = AVAILABLE_VOICES[0];

    const btn = jQuery(btnElement);
    const originalContent = btn.html();
    
    // UI Loading
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

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            btn.removeClass('loading').html('🔊'); // 恢复图标
            URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = () => {
            console.error("Audio playback error");
            btn.removeClass('loading').html('❌');
        };

        await audio.play();

    } catch (error) {
        console.error('TTS Error:', error);
        btn.removeClass('loading').html('❌');
        setTimeout(() => btn.html('🔊'), 2000);
    }
};

// ===== 设置面板：角色列表渲染 =====

function renderCharacterSettings() {
    const $container = jQuery('#quote_tts_char_list');
    $container.empty();

    // 从全局变量获取角色
    const allChars = window.characters || [];
    
    if (allChars.length === 0) {
        $container.html('<div style="padding:10px;">未检测到角色，请先加载角色或在聊天中发言。</div>');
        return;
    }

    allChars.forEach(char => {
        const charName = char.name;
        // 兼容处理：如果没有设置，默认取第一个
        const savedVoice = extension_settings[EXTENSION_NAME].characterMap[charName] || AVAILABLE_VOICES[0];

        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        const row = `
            <div class="quote-tts-settings-row">
                <span class="char-name" title="${charName}">${charName}</span>
                <select class="text_pole" onchange="window.updateQuoteTTSChar('${charName.replace(/'/g, "\\'")}', this.value)">
                    ${optionsHtml}
                </select>
            </div>
        `;
        $container.append(row);
    });
}

// 保存配置 (挂载到 Window 供 HTML onchange 调用)
window.updateQuoteTTSChar = function(charName, voice) {
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { characterMap: {} };
    
    extension_settings[EXTENSION_NAME].characterMap[charName] = voice;
    saveSettingsDebounced();
};

// ===== 主入口 =====
jQuery(() => {
    initSettings();
    initChatListener();
});
