<div align="center">
  <img src=".github/assets/leemo-icon.svg" width="88" alt="Leemo" />
  <h1>Leemo</h1>
  <p><strong>An AI companion that can actually get things done on your computer.</strong></p>
  <p>Think things through together, then turn them into real work.</p>
  <p>
    <a href="https://github.com/CheaperjamRen/leemo/releases/latest"><strong>Download for Windows</strong></a> ·
    <a href="README.md">简体中文</a> ·
    <a href="https://github.com/CheaperjamRen/leemo/issues">Report an issue</a>
  </p>
  <p>
    <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=flat-square" />
    <img alt="Preview" src="https://img.shields.io/badge/release-preview-ea7c2b?style=flat-square" />
    <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-3f7663?style=flat-square" /></a>
  </p>
</div>

![Leemo companion mode](.github/assets/leemo-buddy.png)

Leemo brings `momo`, a companion that gets to know you, and a capable local AI agent into one desktop app.

Start with a half-formed idea, then let momo continue inside a real folder. Or hand over a document, a goal, or a task and let Leemo research, organize, create useful output, and pick up the context again when you return days later.

## One momo, two ways to work

### Companion mode

For conversation, clearer thinking, difficult choices, learning, career questions, and everyday decisions. momo can offer a real point of view without rewriting your request or pushing ordinary work back onto you.

### Workbench mode

For getting the work done. Open any local folder as a notebook and momo can read material, create and edit files, search the web, and use tools within the permission level you choose. Conversations, artifacts, and project context stay connected to that notebook.

## What Leemo can do

- **Work with local material**: read, search, organize, and edit files, then turn conversation into useful artifacts.
- **Read and create documents**: work with PDF, Markdown, Word, Excel, and PowerPoint files.
- **Research and keep moving**: use web search, academic sources, and browser tools to turn an answer into the next action.
- **Handle multi-step work**: run tools, track tasks and progress, and show a compact receipt of what changed.
- **Run on your schedule**: create one-off, daily, or weekly tasks and review their results and run history.
- **Remember what matters**: separate long-term preferences, current circumstances, and notebook-specific context. Memory stays reviewable, editable, and deletable.
- **Use the models you prefer**: connect popular model providers, aggregators, or local runtimes, or enter your own endpoint.
- **Extend the agent**: add workflows, sources, and tools through Skills and MCP instead of waiting for a fixed feature list.

## Download and install

Leemo currently supports Windows 10/11 x64.

1. Open the [latest release](https://github.com/CheaperjamRen/leemo/releases/latest).
2. Download and run `Leemo-Setup-*.exe`.
3. Launch Leemo and follow the model setup flow.

Leemo is still in preview and the installer does not yet carry a commercial code-signing certificate. If Windows SmartScreen displays a warning, make sure the installer came from this repository's Release page and compare its SHA-256 with the value published there.

## Your first session

1. Open **Settings → Models** and choose the model service you use.
2. Enter the required credentials and model information, then select **Test connection**.
3. Return to companion mode, or enter the workbench and create or open a notebook.
4. Choose the permission level that fits the task. You can ask Leemo to confirm important actions or grant full access when you want the least friction.

Leemo includes setup paths for popular choices such as DeepSeek, Kimi, Zhipu GLM, Qwen, OpenAI, Anthropic, Gemini, MiniMax, Doubao, MiMo, NVIDIA, SiliconFlow, OpenRouter, TokenFlux, Ollama, and LM Studio.

## Local first, under your control

- A notebook is the real local folder you choose, not a proprietary container.
- Model credentials are encrypted with the operating system's secure storage and are not passed through the interface process as plaintext.
- File changes, command execution, and external access follow the permission level you select.
- Memory is not an invisible black box: you can review what momo remembers, correct it, or remove it.
- Cloud models, search services, and third-party tools receive the content required to complete the actions you request. Local-first does not mean every inference runs locally.

## Feedback and contributions

Found a problem or have a product suggestion? Open a [GitHub Issue](https://github.com/CheaperjamRen/leemo/issues). Do not include API keys, private files, or other sensitive information in a public report. See the [security policy](SECURITY.md) for security-related reports.

To contribute code, start with the [contributing guide](CONTRIBUTING.md).

## License

Leemo-owned source code is available under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses or terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
