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

const EXTENSION_NAME = "quote_tts";
const SETTINGS_CONTAINER_ID = "quote_tts_settings_container";

// ===== 核心：设置面板注入逻辑 =====

/**
 * 检查并注入设置面板
 * 使用 setInterval 循环调用，以应对 SillyTavern 动态加载扩展菜单的特性
 */
function checkAndInjectSettings() {
    // 1. 检查 ST 的扩展设置容器是否存在
    const $settingsArea = $("#extensions_settings");
    if ($settingsArea.length === 0) return;

    // 2. 检查我们自己的面板是否已经存在
    if ($(`#${SETTINGS_CONTAINER_ID}`).length > 0) return;

    // 3. 定义 HTML 模板 (内联 HTML，无需额外文件)
    const settingsHtml = `
    <div id="${SETTINGS_CONTAINER_ID}" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Quote TTS</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            
            <div class="inline-drawer-content" style="display:none;">
                <div style="margin-bottom: 15px; font-size: 0.9em; opacity: 0.8; padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px;">
                    <i class="fa-solid fa-circle-check"></i> 
                    API 已预置连接至 <code>hony-wen.com</code>。<br>
                    请点击下方按钮读取当前角色，并分配音色。
                </div>
                
                <div class="flex-container alignitemscenter" style="justify-content: space-between; margin-bottom: 10px;">
                    <strong>角色音色绑定</strong>
                    <div id="quote_tts_refresh_btn" class="menu_button interactable">
                        <i class="fa-solid fa-rotate"></i> 刷新角色列表
                    </div>
                </div>

                <div id="quote_tts_char_list" class="quote-tts-list-container">
                    <div style="text-align:center; padding: 20px; opacity: 0.5;">
                        请点击“刷新角色列表”按钮
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;

    // 4. 注入 DOM
    $settingsArea.append(settingsHtml);

    // 5. 绑定折叠/展开事件
    const $container = $(`#${SETTINGS_CONTAINER_ID}`);
    const $toggleBtn = $container.find(".inline-drawer-toggle");
    const $content = $container.find(".inline-drawer-content");
    const $icon = $toggleBtn.find(".inline-drawer-icon");

    $toggleBtn.on("click", () => {
        $content.slideToggle(200);
        if ($icon.hasClass("down")) {
            $icon.removeClass("down").addClass("up");
        } else {
            $icon.removeClass("up").addClass("down");
        }
    });

    // 6. 绑定功能按钮
    $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
}

// ===== 核心：聊天监听逻辑 =====

function initChatListener() {
    const observer = new MutationObserver(() => {
        processAllMessages();
    });
    
    // 监听聊天主容器
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }
    
    // 立即处理一次
    processAllMessages();
}

function processAllMessages() {
    // 遍历所有消息文本块
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 避免重复处理
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
    // 匹配引号: "" “” ‘’ 「」 『』
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        if (!content || content.trim().length === 0) return match;
        
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);

        // 插入按钮，调用 window.playQuoteTTS
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放 TTS" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) {
        $element.html(newHtml);
    }
}

// ===== 功能：播放音频 =====

window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation(); // 防止触发消息编辑

    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    
    // 读取配置
    const settings = extension_settings[EXTENSION_NAME] || { characterMap: {} };
    let voice = settings.characterMap[charName];
    
    // 默认音色
    if (!voice) voice = AVAILABLE_VOICES[0];

    const $btn = $(btnElement);
    
    // UI Loading 状态
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

        if (!response.ok) throw new Error(`API Status: ${response.status}`);

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html('🔊');
            URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = () => {
            console.error("Playback failed");
            $btn.removeClass('loading').html('❌');
            setTimeout(() => $btn.html('🔊'), 2000);
        };

        await audio.play();

    } catch (error) {
        console.error('QuoteTTS Error:', error);
        $btn.removeClass('loading').html('❌');
        // 使用 toastr 提示 (ST内置库)
        if (typeof toastr !== 'undefined') toastr.error(`TTS Error: ${error.message}`);
        setTimeout(() => $btn.html('🔊'), 2000);
    }
};

// ===== 功能：渲染角色列表 =====

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // 尝试获取全局角色
    const allChars = window.characters || [];
    
    if (allChars.length === 0) {
        $container.html('<div style="padding:15px; text-align:center;">暂无角色数据，请先加载角色。</div>');
        return;
    }

    allChars.forEach(char => {
        const charName = char.name;
        // 获取已保存的设置
        if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { characterMap: {} };
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

// 全局保存函数
window.updateQuoteTTSChar = function(charName, voice) {
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = { characterMap: {} };
    extension_settings[EXTENSION_NAME].characterMap[charName] = voice;
    saveSettingsDebounced();
};

// ===== 初始化入口 =====

jQuery(async () => {
    // 1. 初始化设置对象
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { characterMap: {} };
    }

    // 2. 启动聊天监听
    initChatListener();

    // 3. 启动设置面板注入循环
    // 每 500ms 检查一次设置菜单是否存在，确保动态注入成功
    setInterval(checkAndInjectSettings, 500);
});
