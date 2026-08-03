<div align="center">
  <img src=".github/assets/leemo-icon.svg" width="88" alt="Leemo" />
  <h1>Leemo</h1>
  <p><strong>一个真正能在你电脑上做事的 AI 搭子。</strong></p>
  <p>陪你想清楚，也替你动手完成。</p>
  <p>
    <a href="https://github.com/CheaperjamRen/leemo/releases/latest"><strong>下载 Windows 版</strong></a> ·
    <a href="README.en.md">English</a> ·
    <a href="https://github.com/CheaperjamRen/leemo/issues">反馈问题</a>
  </p>
  <p>
    <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=flat-square" />
    <img alt="Preview" src="https://img.shields.io/badge/release-preview-ea7c2b?style=flat-square" />
    <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-3f7663?style=flat-square" /></a>
  </p>
</div>

![Leemo 搭子态](.github/assets/leemo-buddy.png)

Leemo 把能理解你的 `momo` 和能操作本地文件、网页与工具的 AI Agent 放进了同一个桌面应用。

你可以先和 momo 聊一个模糊的想法，再让它打开真实文件夹继续工作；也可以直接交给它一份资料、一个目标或一件待办，让它查找信息、整理文件、生成成果，并在几天后回来时接着上次的进度继续。

## 一个 momo，两种状态

### 搭子态

适合聊天、梳理想法、比较选择，以及讨论学习、求职和生活中的问题。momo 会给出自己的判断，但不会擅自曲解你的要求，也不会把普通任务推回给你。

### 工作台

适合真正把事情做完。把任意本地文件夹作为「本子」打开，momo 就能在你选择的权限范围内阅读资料、创建和修改文件、搜索网络、调用工具，并把对话、成果和项目上下文留在这个本子里。

## Leemo 能帮你做什么

- **处理本地资料**：阅读、搜索、整理和修改文件，把聊天结果落成真正可用的产物。
- **阅读与创作文档**：处理 PDF、Markdown、Word、Excel 和 PowerPoint 等常见文档。
- **查资料并继续行动**：使用联网搜索、学术资料源和浏览器，把答案变成下一步工作。
- **完成多步骤任务**：运行工具、管理待办、追踪进度，并用轻量回执告诉你做了什么。
- **按时替你执行**：创建一次、每天或每周运行的任务，随时查看结果与运行记录。
- **记住真正重要的事**：区分你的长期偏好、近期状态和不同本子的上下文；记忆可查看、修改和删除。
- **使用你喜欢的模型**：连接常见模型服务、聚合平台或本地模型，也可以填写自己的服务地址。
- **按需扩展能力**：通过 Skills 和 MCP 增加新的工作流、资料源与工具，不被固定功能列表限制。

## 下载与安装

Leemo 目前提供 Windows 10/11 x64 版本。

1. 打开 [最新版本页面](https://github.com/CheaperjamRen/leemo/releases/latest)。
2. 下载 `Leemo-Setup-*.exe` 并运行安装。
3. 启动 Leemo，按照引导完成模型连接。

Leemo 仍处于预览阶段，安装包暂未购买商业代码签名证书。如果 Windows SmartScreen 弹出提醒，请从本仓库的 Release 页面下载，并核对页面公布的 SHA-256 校验值。

## 第一次使用

1. 打开「设置 → 模型」，选择你正在使用的模型服务。
2. 填写凭据和模型信息，然后点击「测试连接」。
3. 回到搭子态开始聊天，或者进入工作台新建、打开一个本子。
4. 根据任务选择权限档位；需要省心时可以开启完全访问，也可以让 Leemo 在关键操作前询问你。

Leemo 已为 DeepSeek、Kimi、智谱 GLM、通义千问、OpenAI、Anthropic、Gemini、MiniMax、豆包、MiMo、NVIDIA、硅基流动、OpenRouter、TokenFlux、Ollama、LM Studio 等常见选择准备了配置入口。

## 本地优先，控制权归你

- 本子就是你选择的真实本地文件夹，不会被锁在 Leemo 的私有格式里。
- 模型凭据由系统安全存储加密，不会在界面进程中以明文传递。
- 文件修改、命令执行和外部访问遵循你选择的权限设置。
- 记忆不是不可见的黑盒：你可以查看 momo 记住了什么，也可以纠正或删除。
- 使用云模型、搜索服务或第三方工具时，完成任务所需的内容会发送给相应服务；本地优先不等于所有推理都在本地完成。

## 反馈与参与

遇到问题或有产品建议，欢迎提交 [GitHub Issue](https://github.com/CheaperjamRen/leemo/issues)。请不要在公开反馈中附带 API Key、私人文件或其他敏感信息；安全问题请参阅 [安全说明](SECURITY.md)。

希望参与开发，可以从 [贡献指南](CONTRIBUTING.md) 开始。

## 许可证

Leemo 自有源码采用 [Apache License 2.0](LICENSE)。第三方组件保留各自的许可证或使用条款，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
