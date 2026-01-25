import { extension_settings, getContext } from "../../../extensions.js";
// 引入 getRequestHeaders 以通过 SillyTavern 的后端鉴权
import { saveSettingsDebounced, getRequestHeaders } from "../../../../script.js";

// ===== 配置常量 =====
const EXTENSION_NAME = "st-Quote-TTS"; 
const EXTENSION_FOLDER_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;

// Edge-TTS 配置 (目标服务)
const TARGET_ENDPOINT = "http://h.hony-wen.com:5050/v1/audio/speech";
const API_KEY = "nyaa";
const MODEL_ID = "tts-1-hd";
const AVAILABLE_VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural", "zh-CN-YunyangNeural"];

// 试听文本
const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";

// ST 后端代理接口 (解决 CORS 的关键)
// 只有通过这个内置路由转发，浏览器才不会拦截跨域请求
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

    // 循环检查容器，修复面板可能不显示的问题
    const checkInterval = setInterval(async () => {
        const $settingsContainer = $("#extensions_settings");
        
        // 只有当 ST 扩展容器存在，且我们的面板还没插入时才执行
        if ($settingsContainer.length > 0 && $(".quote-tts-extension-settings").length === 0) {
            clearInterval(checkInterval);
            
            try {
                // 加载外部 HTML
                const settingsHtml = await $.get(`${EXTENSION_FOLDER_PATH}/settings.html`);
                $settingsContainer.append(settingsHtml);
                
                // 绑定刷新按钮事件
                $("#quote_tts_refresh_btn").on("click", renderCharacterSettings);
                
                // 启动聊天监听 (核心：给聊天记录加按钮)
                initChatListener();
                
                console.log("[Quote TTS] 面板加载成功");
            } catch (error) {
                console.error(`[Quote TTS] 加载 settings.html 失败: ${error}`);
            }
        }
    }, 500);
});

// ===== 逻辑功能实现：设置面板 =====

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    // --- 1. 获取角色列表 ---
    const context = getContext();
    const participants = new Set();

    // 用户
    if (context.name2) participants.add(context.name2);
    else participants.add("User");

    // 当前角色
    if (context.characterId !== undefined && context.characterId !== null) {
        const currentCharacter = window.characters && window.characters[context.characterId];
        if (currentCharacter && currentCharacter.name) participants.add(currentCharacter.name);
    }

    // 扫描屏幕上的角色名 (补全)
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

        // 保存设置
        $row.find('select').on('change', function() {
            const newVal = $(this).val();
            updateQuoteTTSChar(charName, newVal);
        });

        // 试听按钮 (调用统一的 playTTS)
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

/**
 * 核心播放函数
 * 所有的 TTS 请求（无论是试听还是聊天）最终都必须经过这里
 * 它使用 SillyTavern 的 getRequestHeaders() 和代理路径来避免 CORS
 */
async function playTTS(btnElement, text, voice) {
    const $btn = $(btnElement);
    if ($btn.hasClass('loading')) return;

    const originalIcon = $btn.html();
    $btn.addClass('loading').html('⏳');

    try {
        const response = await fetch(ST_PROXY_URL, {
            method: 'POST',
            headers: getRequestHeaders(), // 这里的 Header 是给 ST 后端看的，用于验证用户身份
            body: JSON.stringify({
                // 这些参数是给 ST 后端转发请求用的
                provider_endpoint: TARGET_ENDPOINT, 
                model: MODEL_ID,
                input: text,
                voice: voice,
                response_format: 'mp3',
                // 将 API Key 放入 body，让 ST 后端转发给 h.hony-wen.com
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
            if (typeof toastr !== 'undefined') toastr.error("音频解码失败");
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

// ===== 核心功能：聊天记录集成 (暴露给 Window) =====

// 这里的函数会被 HTML 中的 onclick 调用
window.playQuoteTTS = async function(btnElement, encodedText, encodedCharName) {
    if (event) event.stopPropagation(); // 防止点击穿透触发编辑
    
    const text = decodeURIComponent(encodedText);
    const charName = decodeURIComponent(encodedCharName);
    
    // 获取角色对应的音色
    const settings = extension_settings[SETTING_KEY] || { characterMap: {} };
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    
    // 直接调用上面验证成功的 Proxy 播放函数
    await playTTS(btnElement, text, voice);
};


// ===== 核心功能：聊天监听与注入 =====

function initChatListener() {
    const observer = new MutationObserver(() => processAllMessages());
    const chatContainer = document.querySelector('#chat');
    if (chatContainer) {
        observer.observe(chatContainer, { childList: true, subtree: true });
    }
    // 初始运行一次，处理已有消息
    processAllMessages();
}

function processAllMessages() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        // 防止重复处理
        if ($msgBlock.attr('data-quote-tts-processed')) return;
        
        $msgBlock.attr('data-quote-tts-processed', 'true');
        const $parentBlock = $msgBlock.closest('.mes_block');
        const charName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, charName);
    });
}

function injectPlayButtons($element, charName) {
    let html = $element.html();
    
    // 正则：兼容中文“”‘’、日文「」『』、英文""
    // 分组1：左引号，分组2：内容，分组3：右引号
    const quoteRegex = /([“"‘「『])([\s\S]*?)([”"’」』])/g;

    const newHtml = html.replace(quoteRegex, (match, openQuote, content, closeQuote) => {
        // 过滤空内容
        if (!content || content.trim().length === 0) return match;
        
        const safeContent = encodeURIComponent(content);
        const safeCharName = encodeURIComponent(charName);
        
        // 注入按钮，点击时调用 window.playQuoteTTS
        return `${openQuote}${content}${closeQuote}<span class="quote-tts-btn interactable" title="播放" onclick="window.playQuoteTTS(this, '${safeContent}', '${safeCharName}')">🔊</span>`;
    });

    if (html !== newHtml) $element.html(newHtml);
}
