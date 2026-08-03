<div align="center">
  <img src=".github/assets/leemo-icon.svg" width="88" alt="Leemo" />
  <h1>Leemo</h1>
  <p><strong>一个会在相处中越来越懂你，也能在电脑上把事情做完的 AI 搭子。</strong></p>
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

## Leemo 是什么

Leemo 是一款面向中文用户的桌面 AI 应用。住在里面的 **momo** 不只是回答问题：它会慢慢记住你在意什么、最近正忙什么、习惯怎样做决定，也能读取本地资料、使用工具，把聊清楚的事情真正做下去。

许多 AI 对话结束于一个答案，下一次见面又要重新解释自己。在 Leemo 里，你可以先和 momo 聊一个还很模糊的念头，让它帮你理清真正的问题；也可以让同一个 momo 进入真实文件夹继续工作：查资料、整理文件、写出结果。几天后回来，它仍然知道你是谁、这件事为什么重要，以及上次进行到了哪里。

例如，你可以让 Leemo：

- 阅读一组课程资料，整理重点并生成复习计划；
- 打开简历与岗位文件夹，对照岗位要求修改材料；
- 搜集资料、核对来源，再把结论写进本地文档；
- 整理一个混乱的文件夹，并在修改前向你说明方案；
- 记住你的长期偏好、近期计划和不同项目的背景；
- 按设定的时间运行任务，回来后直接查看结果。

## 不只是更聪明，而是更懂你

momo 会把相处中真正重要的信息分开记住：长期不变的偏好、最近发生的变化，以及只属于某个本子的背景。它不会把每句闲聊都永久保存，也不会把自己的猜测当成你的原话。

这份理解会回到每一次对话和任务里。讨论选择时，momo 知道你看重什么；一起学习时，它知道你的目标和节奏；进入工作台后，也不需要突然换成一个冷冰冰、完全不认识你的工具。

momo 可以有观点、指出问题，也会尊重你的最终决定。它记住的内容始终可以查看、修改或删除：关系可以越来越深，控制权仍然在你手里。

## 一个 momo，两种状态

### 搭子态

适合聊天、梳理想法、比较选择，以及讨论学习、求职和生活中的问题。momo 可以有自己的判断，但不会擅自曲解你的要求，也不会把本来能做的事情推回给你。

### 工作台

适合真正动手完成任务。你可以把任意本地文件夹作为一个「本子」打开。这里的本子就是电脑上的真实文件夹，不是只能在 Leemo 中打开的特殊格式。

在本子里，momo 可以在你允许的范围内阅读资料、创建和修改文件、联网搜索、调用工具，并让对话始终围绕这个文件夹里的事情继续。换一台电脑或换一个 AI 模型，你的文件仍然属于你。

## 主要能力

- **处理本地资料**：阅读、搜索、整理和修改文件，把聊天内容变成电脑上真正存在的结果。
- **完成复杂任务**：拆分步骤、调用工具、追踪进度，并用简短提示告诉你完成了什么。
- **联网与学术搜索**：查询公开网络和学术资料，保留来源，避免只给出无法核对的结论。
- **越用越懂你**：区分长期偏好、近期状态和不同本子的背景，让后续对话不必一次次从头解释。
- **定时执行**：支持一次、每天或每周运行的任务，并保留运行结果。
- **自由选择模型**：可连接常见 AI 服务、聚合平台和本地模型，不被单一服务绑定。
- **按需增加能力**：可以安装新的 Skills 或连接外部工具，让 Leemo 适应更多工作流。

## 下载与安装

Leemo 目前支持 Windows 10/11 x64。

1. 打开 [最新版本页面](https://github.com/CheaperjamRen/leemo/releases/latest)。
2. 下载 `Leemo Setup 0.1.0.exe`。
3. 双击安装，启动 Leemo，然后按引导连接你正在使用的 AI 服务。

Leemo 目前处于预览阶段，安装包暂未购买商业代码签名证书。如果 Windows SmartScreen 弹出提醒，请确认文件来自本仓库的 Release 页面，并核对 Release 中公布的 SHA-256。

## 第一次使用

1. 打开「设置 → 模型」，选择 DeepSeek、Kimi、智谱 GLM、通义千问、OpenAI 等你正在使用的服务。
2. 按页面提示填写 API Key；如果服务商提供了自定义地址，再填写 Base URL。
3. 点击「测试连接」。测试成功后，回到搭子态开始聊天，或者进入工作台打开一个本地文件夹。
4. 选择 Leemo 可以执行到什么程度：重要操作前询问你，或在你明确授权后直接完成。

Leemo 已准备 DeepSeek、Kimi、智谱 GLM、通义千问、OpenAI、Anthropic、Gemini、MiniMax、豆包、MiMo、NVIDIA、硅基流动、OpenRouter、TokenFlux、Ollama、LM Studio 等常见配置入口，也支持自定义服务。

## 本地优先，控制权归你

- 本子就是你选择的真实本地文件夹，随时可以用其他软件打开。
- API Key 使用 Windows 的安全存储加密，不会作为普通文本保存在界面中。
- 文件修改、命令执行和外部访问遵循你选择的权限设置。
- momo 的记忆不是不可见的黑盒：你可以查看它记住了什么，也可以纠正或删除。
- 使用云端 AI、搜索服务或第三方工具时，完成任务所需的内容会发送给相应服务。

## 反馈与参与

遇到问题或有产品建议，欢迎提交 [GitHub Issue](https://github.com/CheaperjamRen/leemo/issues)。请不要在公开反馈中附带 API Key、私人文件或其他敏感信息；安全问题请参阅 [安全说明](SECURITY.md)。

希望参与开发，可以从 [贡献指南](CONTRIBUTING.md) 开始。

## 许可证

Leemo 自有源码采用 [Apache License 2.0](LICENSE)。第三方组件保留各自的许可证或使用条款，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
