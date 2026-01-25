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

    // 2. 注入设置面板
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

    // 3. 注册事件监听
    initSafeEventListeners();
});

// ===== 核心逻辑：安全的事件监听 =====
function initSafeEventListeners() {
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(() => processChatSafe(), 200));
        eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(() => processChatSafe(), 1000));
    }
    setTimeout(() => processChatSafe(), 2000);
}

// ===== 核心逻辑：消息处理 =====
function processChatSafe() {
    $('.mes_text').each(function() {
        const $msgBlock = $(this);
        
        // 跳过正在生成的文本
        if ($msgBlock.closest('.mes_block').find('.typing_indicator').length > 0) return;
        // 跳过已处理的文本
        if ($msgBlock.find('.quote-tts-btn').length > 0) return;

        const $parentBlock = $msgBlock.closest('.mes_block');
        const blockSenderName = $parentBlock.find('.name_text').text().trim();
        
        injectPlayButtons($msgBlock, blockSenderName);
    });
}

function injectPlayButtons($element, blockSenderName) {
    let html = $element.html();
    
    // 正则表达式升级：支持 "角色名: “引号内容”" 的格式识别
    // Group 1 (可选): 角色名后缀 (匹配冒号前的名字，排除标签和特殊符号，限制长度20)
    // Group 2: 引号内容
    // 逻辑：(?:(?:^|>|[\n\r])\s*([^\s:<>&"']{1,20}?):\s*)?  --> 尝试匹配 "Name:"
    //       ([“‘「『][\s\S]*?[”’」』])                     --> 匹配引号内容
    //       (?!\s*<span class="quote-tts-btn)              --> 排除已存在的按钮
    const smartQuoteRegex = /(?:(?:^|>|[\n\r])\s*([^\s:<>&"']{1,20}?):\s*)?([“‘「『][\s\S]*?[”’」』])(?!\s*<span class="quote-tts-btn)/g;

    let hasChanges = false;
    const newHtml = html.replace(smartQuoteRegex, (match, inlineName, content) => {
        // inlineName 是正则 Group 1 捕获的文本内角色名 (例如 "Alice")
        // content    是正则 Group 2 捕获的引号文本 (例如 "“你好”")
        
        if (!content || content.trim().length === 0) return match;
        
        // 防御性检查
        if (content.includes('quote-tts-btn')) return match;

        // 提取纯文本用于 TTS
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const plainText = tempDiv.textContent || tempDiv.innerText || "";
        
        // 核心逻辑：如果正则抓到了文内名字(inlineName)，就优先用它；否则用消息块发送者(blockSenderName)
        const targetCharName = (inlineName && inlineName.trim()) ? inlineName.trim() : blockSenderName;
        
        const safeText = encodeURIComponent(plainText);
        const safeCharName = encodeURIComponent(targetCharName);
        
        hasChanges = true;
        
        // 如果匹配到了 "Name: Quote"，match 包含整个字符串，我们需要小心处理替换逻辑
        // 因为 replace 替换的是整个 match，所以我们要尽量保持原有格式
        // 这里稍微复杂一点：如果 match 包含了 Name:，我们需要把 Name: 也放回去
        
        // 简单策略：直接在 content (引号部分) 后面追加按钮。
        // 但我们需要返回完整的 match 字符串，并在最后插入按钮。
        
        return `${match}<span class="quote-tts-btn interactable" title="播放 (${targetCharName})" onclick="window.playQuoteTTS(this, '${safeText}', '${safeCharName}')">🔊</span>`;
    });

    if (hasChanges) {
        $element.html(newHtml);
    }
}


// ===== 逻辑功能：设置面板 (增强版扫描) =====
function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    const context = getContext();
    const participants = new Set();

    // 1. 基础角色
    if (context.name2) participants.add(context.name2);
    else participants.add("User");

    if (context.characterId !== undefined && context.characterId !== null) {
        const currentCharacter = window.characters && window.characters[context.characterId];
        if (currentCharacter && currentCharacter.name) participants.add(currentCharacter.name);
    }

    // 2. 扫描消息块发送者 (Block Sender)
    $('#chat .name_text').each(function() {
        const name = $(this).text().trim();
        if (name) participants.add(name);
    });

    // 3. 深度扫描文本内容 (Inline Names)
    // 查找形如 "Alice: “..." 的模式，将 Alice 加入列表
    $('#chat .mes_text').each(function() {
        const text = $(this).text();
        // 简单的正则来提取文本中的名字
        const inlineNameScanRegex = /(?:^|\n)\s*([^\s:<>&"']{1,20}?):\s*[“‘「『]/g;
        let match;
        while ((match = inlineNameScanRegex.exec(text)) !== null) {
            if (match[1]) participants.add(match[1].trim());
        }
    });

    if (participants.size === 0) {
        $container.html('<div style="padding:15px; text-align:center;">未检测到角色，请先加载对话。</div>');
        return;
    }

    // 排序：将主角色放前面，其他按字母排序
    const sortedParticipants = Array.from(participants).sort();

    sortedParticipants.forEach(charName => {
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
                    <span class="quote-tts-preview-btn interactable" title="试听 (${charName})">🔊</span>
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
    // 如果找不到特定名字的配置，尝试回退到默认或者 BlockSender (这由调用时的逻辑保证，这里只管查表)
    const voice = settings.characterMap[charName] || AVAILABLE_VOICES[0];
    
    await playTTS(btnElement, text, voice);
};
