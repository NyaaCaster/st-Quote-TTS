// ... (之前的 import 和 常量定义 保持不变)

// 新增常量：试听文本
const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";

// ... (loadSettings, jQuery init 等保持不变) ...

// ===== 核心逻辑：获取角色列表 (修改了内部 HTML 结构) =====

function renderCharacterSettings() {
    const $container = $('#quote_tts_char_list');
    $container.empty();

    const context = getContext();
    const participants = new Set();

    // ... (获取角色名的逻辑保持不变: user, char, DOM scan) ...
    // 2. 添加当前用户
    if (context.name2) participants.add(context.name2);
    else participants.add("User");

    // 3. 添加当前角色
    if (context.characterId !== undefined && context.characterId !== null) {
        const currentCharacter = window.characters && window.characters[context.characterId];
        if (currentCharacter && currentCharacter.name) participants.add(currentCharacter.name);
    }

    // 4. 扫描 DOM
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

        // --- 修改点：HTML 结构增加了试听按钮 ---
        const $row = $(`
            <div class="quote-tts-settings-row">
                <span class="char-name" title="${charName}">${charName}</span>
                <div class="quote-tts-controls">
                    <!-- 试听按钮 -->
                    <span class="quote-tts-preview-btn interactable" title="试听当前选择的音色">🔊</span>
                    <!-- 下拉菜单 -->
                    <select class="text_pole">
                        ${optionsHtml}
                    </select>
                </div>
            </div>
        `);

        // 绑定下拉框保存事件
        $row.find('select').on('change', function() {
            const newVal = $(this).val();
            updateQuoteTTSChar(charName, newVal);
        });

        // --- 修改点：绑定试听按钮点击事件 ---
        $row.find('.quote-tts-preview-btn').on('click', async function(e) {
            e.stopPropagation();
            // 获取当前行下拉框中选中的值 (实时获取，而非读取保存的设置)
            const currentSelectedVoice = $row.find('select').val();
            await playPreviewTTS(this, currentSelectedVoice);
        });

        $container.append($row);
    });
    
    if (typeof toastr !== 'undefined') toastr.success(`已加载 ${participants.size} 名角色`);
}

// ... (updateQuoteTTSChar, initChatListener, processAllMessages, injectPlayButtons 等保持不变) ...

// ===== 新增：试听播放逻辑 =====

async function playPreviewTTS(btnElement, voice) {
    const $btn = $(btnElement);
    
    // 防止重复点击
    if ($btn.hasClass('loading')) return;

    // UI Loading
    const originalIcon = $btn.html();
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
                input: PREVIEW_TEXT, // 使用固定的试听文本
                voice: voice,
                response_format: "mp3"
            })
        });

        if (!response.ok) throw new Error(`API: ${response.status}`);
        
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            $btn.removeClass('loading').html(originalIcon);
            URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = () => {
            console.error("Preview playback failed");
            $btn.removeClass('loading').html('❌');
            setTimeout(() => $btn.html(originalIcon), 2000);
        };

        await audio.play();

    } catch (e) {
        console.error("Preview Error:", e);
        if (typeof toastr !== 'undefined') toastr.error("试听播放失败");
        $btn.removeClass('loading').html('❌');
        setTimeout(() => $btn.html(originalIcon), 2000);
    }
}

// ... (window.playQuoteTTS 保持不变)
