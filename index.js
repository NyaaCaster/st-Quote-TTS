import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

const HARDCODED_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
const HARDCODED_API_KEY = "nyaa";
const DEFAULT_MODEL = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];

// ===== 初始化设置 =====
const SETTING_KEY = "quote_tts"; 

async function loadSettings() {
    if (!extension_settings[SETTING_KEY]) {
        extension_settings[SETTING_KEY] = { characterMap: {} };
    }
}

// ===== 核心逻辑：加载 HTML 与绑定事件 =====
jQuery(async () => {
    await loadSettings();

    try {
        const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
        $("#extensions_settings").append(settingsHtml);

        // 绑定刷新按钮
        $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);

        // 启动聊天监听
        initChatListener();

    } catch (error) {
        console.error(`[Quote TTS] Failed to load settings.html: ${error}`);
    }
});


// ===== 逻辑功能实现：获取角色列表 (核心修改) =====

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // 1. 获取上下文
    const context = getContext();
    // 使用 Set 去重
    const participants = new Set();

    // 2. 添加当前用户 ({{user}})
    if (context.name2) {
        participants.add(context.name2);
    } else {
        participants.add("User"); // 默认回退
    }

    // 3. 添加当前主要角色 ({{char}})
    // context.characterId 是当前选中角色的索引
    if (context.characterId !== undefined && context.characterId !== null) {
        // window.characters 是全局角色数组
        const currentCharacter = window.characters && window.characters[context.characterId];
        if (currentCharacter && currentCharacter.name) {
            participants.add(currentCharacter.name);
        }
    }

    // 4. 扫描 DOM 聊天记录 (补全群聊成员或历史记录中的角色)
    // 这是一个非常稳健的方法，能获取当前屏幕上出现过的所有名字
    $('#chat .name_text').each(function() {
        const name = $(this).text().trim();
        if (name) participants.add(name);
    });

    // 5. 渲染列表
    if (participants.size === 0) {
        $container.html('<div style="padding:15px; text-align:center;">未检测到角色，请先加载对话。</div>');
        return;
    }

    participants.forEach(charName => {
        // 读取已保存的音色配置
        const savedVoice = extension_settings[SETTING_KEY].characterMap[charName] || AVAILABLE_VOICES[0];

        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        const $row = $(`
            <div class="quote-tts-settings-row">
                <span class="char-name" title="${charName}">${charName}</span>
                <select class="text_pole">
                    ${optionsHtml}
                </select>
            </div>
        `);

        $row.find('select').on('change', function() {
            const newVal = $(this).val();
            updateQuoteTTSChar(charName, newVal);
        });

        $container.append($row);
    });
    
    // 提示刷新成功
    if (typeof toastr !== 'undefined') toastr.success(`已加载 ${participants.size} 名角色`);
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
        
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) $element.html(newHtml);
}

// 挂载到 Window
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation();
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    // 默认回退逻辑：如果有配置用配置，没有配置默认第一个
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
