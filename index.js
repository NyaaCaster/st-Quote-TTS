import { saveSettingsDebounced, getContext, extension_settings } from "../../../extensions.js";

// --- 配置常量 ---
const DEFAULT_API_URL = "http://h.hony-wen.com:5050/v1/audio/speech";
const DEFAULT_API_KEY = "nyaa";
const DEFAULT_MODEL = "tts-1-hd";

const AVAILABLE_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunyangNeural"
];

// 扩展名称（用于设置存储）
const EXTENSION_NAME = "quote_tts";

// 默认设置结构
const defaultSettings = {
    apiUrl: DEFAULT_API_URL,
    apiKey: DEFAULT_API_KEY,
    characterMap: {} // 存储 { "角色名": "VoiceName" }
};

// --- 初始化与加载 ---

// 加载扩展
jQuery(async () => {
    // 初始化设置
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = defaultSettings;
    }

    // 监听聊天记录变化（新消息到达或页面加载）
    const observer = new MutationObserver(onChatChanged);
    observer.observe(document.querySelector('#chat'), { childList: true, subtree: true });

    // 添加设置按钮到扩展菜单
    $("#extensions_settings").append(`
        <div id="quote_tts_settings_container" class="extension_settings_block">
            <h4>Quote TTS (Edge-TTS)</h4>
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header" id="quote_tts_drawer_toggle">
                    <b>点击展开设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" id="quote_tts_drawer_content" style="display:none;">
                    <label>API URL:</label>
                    <input type="text" id="quote_tts_url" class="text_pole" value="${extension_settings[EXTENSION_NAME].apiUrl}" />
                    
                    <label>API Key:</label>
                    <input type="text" id="quote_tts_key" class="text_pole" value="${extension_settings[EXTENSION_NAME].apiKey}" />

                    <hr>
                    <button id="quote_tts_refresh_chars" class="menu_button">🔄 读取当前角色列表</button>
                    <div id="quote_tts_char_list" style="margin-top: 10px;"></div>
                </div>
            </div>
        </div>
    `);

    // 绑定设置事件
    $('#quote_tts_drawer_toggle').click(() => {
        $('#quote_tts_drawer_content').slideToggle();
        $('#quote_tts_drawer_toggle .inline-drawer-icon').toggleClass('down').toggleClass('up');
    });

    $('#quote_tts_url').on('input', function() {
        extension_settings[EXTENSION_NAME].apiUrl = $(this).val();
        saveSettingsDebounced();
    });

    $('#quote_tts_key').on('input', function() {
        extension_settings[EXTENSION_NAME].apiKey = $(this).val();
        saveSettingsDebounced();
    });

    $('#quote_tts_refresh_chars').click(renderCharacterSettings);

    // 初始处理当前页面消息
    processAllMessages();
});

// --- 核心逻辑：UI 注入 ---

// 当聊天DOM变化时触发
function onChatChanged(mutations) {
    // 使用防抖或简单的检查，避免频繁处理
    // 这里简单地对所有没有标记过的消息进行处理
    processAllMessages();
}

function processAllMessages() {
    // 遍历所有消息块
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 如果已经处理过，跳过 (防止重复添加按钮)
        if ($msgBlock.attr('data-quote-tts-processed')) return;
        
        // 标记为已处理
        $msgBlock.attr('data-quote-tts-processed', 'true');

        // 获取当前消息的角色名
        const charName = $msgBlock.closest('.mes_block').find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

// 注入播放按钮的函数
function injectPlayButtons($element, charName) {
    let html = $element.html();

    // 正则表达式匹配引号内容
    // 兼容："" (英文), “” (中文), ‘’ (中文单引号), 「」 (日文), 『』 (日文双引号)
    // 注意：尽量避免匹配到HTML标签内的属性，所以使用非贪婪匹配
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    // 替换文本，加入按钮
    // 我们将 charName 编码后放入 data 属性，以便点击时使用
    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        // 过滤掉太短的内容或空内容
        if (!content || content.trim().length === 0) return match;
        
        // 生成唯一的ID或直接传参
        // 将内容转义以防XSS
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);

        return `${openQuote}${content}${closeQuote}<button class="quote-tts-btn" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</button>`;
    });

    if (html !== newHtml) {
        $element.html(newHtml);
    }
}

// --- 核心逻辑：API 调用 ---

// 挂载到全局 window 对象，因为 HTML 中的 onclick 需要访问它
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    const settings = extension_settings[EXTENSION_NAME];
    
    // 获取为该角色配置的音色，如果没配置则使用第一个默认
    let voice = settings.characterMap[charName];
    if (!voice) {
        // 尝试默认分配策略：如果角色没配置，默认选第一个
        voice = AVAILABLE_VOICES[0];
    }

    // UI 状态：加载中
    const btn = $(btnElement);
    const originalIcon = btn.html();
    btn.addClass('loading').html('⏳');

    try {
        const response = await fetch(settings.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
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
        };

        audio.play();

    } catch (error) {
        console.error('TTS Error:', error);
        toastr.error('TTS播放失败，请检查控制台或配置。');
        btn.removeClass('loading').html('❌');
        setTimeout(() => btn.html(originalIcon), 2000);
    }
};

// --- 设置面板逻辑 ---

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // 获取当前上下文中的角色
    // SillyTavern 的 characters 数组通常可以通过 getContext() 获取，或者从 HTML 解析
    const context = getContext();
    // 获取所有角色列表（包括当前对话的和卡片列表里的）
    // 为了方便，这里我们从 context.characters 获取当前对话的角色
    // 如果想要所有已安装的角色，需要遍历 `characters` 全局变量（如果可用）
    
    // 这里我们读取全局变量 characters (SillyTavern 标准)
    // 过滤掉 'User' (如果需要)
    const allChars = window.characters || []; 
    
    if (allChars.length === 0) {
        $container.html('<p>未找到角色数据。</p>');
        return;
    }

    allChars.forEach(char => {
        const charName = char.name;
        // 读取当前设置
        const savedVoice = extension_settings[EXTENSION_NAME].characterMap[charName] || AVAILABLE_VOICES[0];

        // 生成下拉框选项
        let optionsHtml = '';
        AVAILABLE_VOICES.forEach(v => {
            const selected = v === savedVoice ? 'selected' : '';
            optionsHtml += `<option value="${v}" ${selected}>${v}</option>`;
        });

        const row = `
            <div class="quote-tts-settings-row">
                <span>${charName}</span>
                <select onchange="window.updateQuoteTTSChar('${charName.replace(/'/g, "\\'")}', this.value)">
                    ${optionsHtml}
                </select>
            </div>
        `;
        $container.append(row);
    });
}

// 保存角色音色映射
window.updateQuoteTTSChar = function(charName, voice) {
    extension_settings[EXTENSION_NAME].characterMap[charName] = voice;
    saveSettingsDebounced();
};
