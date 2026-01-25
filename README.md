# SillyTavern Quote TTS
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
> _一个为 _[_SillyTavern_](https://github.com/SillyTavern/SillyTavern)_ 设计的敏捷语音扩展插件_

## ✨ 功能特性
+ **多语言引号支持**：自动识别并提取以下引号内的文本：
  - 中文引号：`“”` 和 `‘’`
  - 日文引号：`「」` 和 `『』`
+ **角色音色绑定**：可以扫描当前的对话角色，并为每个角色单独指定音色。
+ **UI 集成**：无缝集成到 SillyTavern 的聊天界面，不影响原有排版。

## 📦 安装方法
在 `SillyTavern-扩展-安装扩展` 按钮输入以下链接进行安装：
- 海外地址：
```plain
https://github.com/NyaaCaster/st-Quote-TTS.git
```
- 国内地址：
```plain
https://gitee.com/NyaaCaster/st-Quote-TTS.git
```
安装完成后，**刷新页面** 以加载扩展。

## 📖 使用指南
1. 进入任意对话。
2. 当角色回复的内容包含引号时（例如：`她说：“你好，今天天气真不错。”`），会自动在引号后生成 🔊 播放按钮。
3. 点击该按钮按钮图标会变为 ⏳ ，待音频生成完毕后即自动播放。

## ⚙️ 配置说明
:::warning
打开 `扩展 Quote TTS` 设置面板。
:::

### 角色音色绑定
为了让不同的角色拥有不同的声音，您需要手动绑定音色：

1. 进入对话，确保聊天中产生了对话角色 
2. 在设置面板中，点击 **"****🔄**** 读取当前角色列表"** 按钮。
3. 下方会出现当前会话及卡片列表中的角色名。
4. 使用下拉菜单为每个角色选择音色，支持以下 Edge-TTS 音色：
   - `zh-CN-XiaoxiaoNeural` (女声，新闻/小说，温暖)
   - `zh-CN-XiaoyiNeural` (女声，动漫/小说，活跃)
   - `zh-CN-liaoning-XiaobeiNeural` (女声，辽宁方言，幽默)
   - `zh-CN-shaanxi-XiaoniNeural` (女声，陕西方言，明亮)
   - `zh-HK-HiuGaaiNeural` (女声，香港粤语，通用，友好/积极)
   - `zh-HK-HiuMaanNeural` (女声，香港粤语，通用，友好/积极)
   - `zh-TW-HsiaoChenNeural` (女声，台湾国语，通用，友好/积极)
   - `zh-TW-HsiaoYuNeural` (女声，台湾国语，通用，友好/积极)
   - `zh-CN-YunjianNeural` (男声，运动/小说，热情)
   - `zh-CN-YunxiNeural` (男声，小说，阳光)
   - `zh-CN-YunxiaNeural` (男声，动漫/小说，可爱)
   - `zh-CN-YunyangNeural` (男声，新闻，专业/可靠)
   - `zh-HK-WanLungNeural` (男声，香港粤语，通用，友好/积极)
   - `zh-TW-YunJheNeural` (男声，台湾国语，通用，友好/积极)
5. 修改后设置会自动保存。
