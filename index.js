import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; // 必须与 GitHub 仓库名/文件夹名一致
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

const HARDCODED_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
const HARDCODED_API_KEY = "nyaa";
const DEFAULT_MODEL = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];

// ===== 初始化设置 =====
const SETTING_KEY = "quote_tts"; // 在 extension_settings 中的键名

async function loadSettings() {
    if (!extension_settings[SETTING_KEY]) {
        extension_settings[SETTING_KEY] = { characterMap: {} };
    }
}

// ===== 核心逻辑：加载 HTML 与绑定事件 =====
jQuery(async () => {
    // 1. 加载设置
    await loadSettings();

    // 2. 加载外部 HTML 文件 (模仿示例代码)
    try {
        const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
        
        // 3. 将 HTML 追加到 SillyTavern 的扩展设置区域
        $("#extensions_settings").append(settingsHtml);

        // 4. 绑定事件 (在 HTML 插入 DOM 后进行)
        
        // 绑定刷新按钮
        $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);

        // 启动聊天监听
        initChatListener();

    } catch (error) {
        console.error(`[Quote TTS] Failed to load settings.html: ${error}`);
    }
});


// ===== 逻辑功能实现 =====

// 渲染角色列表
function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // 获取角色列表 (兼容性获取)
    const context = getContext();
    const allChars = window.characters || [];
    
    if (!allChars || allChars.length === 0) {
        $container.html('<div style="padding:15px; text-align:center;">暂无角色数据，请先在聊天栏选择角色。</div>');
        return;
    }

    allChars.forEach(char => {
        const charName = char.name;
        const savedVoice = extension_settings[SETTING_KEY].characterMap[charName] || AVAILABLE_VOICES[0];

        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        // 创建行元素
        const $row = $(`
            <div class="quote-tts-settings-row">
                <span class="char-name" title="${charName}">${charName}</span>
                <select class="text_pole">
                    ${optionsHtml}
                </select>
            </div>
        `);

        // 绑定下拉框变更事件
        $row.find('select').on('change', function() {
            const newVal = $(this).val();
            updateQuoteTTSChar(charName, newVal);
        });

        $container.append($row);
    });
}

function updateQuoteTTSChar(charName, voice) {
    if (!extension_settings[SETTING_KEY]) extension_settings[SETTING_KEY] = { characterMap: {} };
    extension_settings[SETTING_KEY].characterMap[charName] = voice;
    saveSettingsDebounced();
}

// ===== 聊天监听与按钮注入 =====

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
        
        // 依旧使用 window 全局函数处理点击，因为这是插入的 string HTML
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) $element.html(newHtml);
}

// 挂载到 Window 以供 onclick 调用
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation();
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    const $btn = $(btnElement);

    $btn.addClass('loading').html('⏳');

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

        if (!response.ok) throw new Error(`API: ${response.status}`);
        
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html('🔊');
            URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
            $btn.removeClass('loading').html('❌');
        };
        await audio.play();
    } catch (e) {
        console.error(e);
        if (typeof toastr !== 'undefined') toastr.error("TTS 播放失败");
        $btn.removeClass('loading').html('❌');
        setTimeout(() => $btn.html('🔊'), 2000);
    }
};
