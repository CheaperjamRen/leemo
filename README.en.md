<div align="center">
  <img src="build/icon.svg" width="88" alt="Leemo" />
  <h1>Leemo</h1>
  <p><strong>A desktop AI agent that remembers you and gets things done on your computer.</strong></p>
  <p>From a thought captured in the moment to results saved in local files.</p>
  <p>
    <a href="https://github.com/CheaperjamRen/leemo/releases/latest"><strong>Download for Windows</strong></a> ·
    <a href="README.md">简体中文</a> ·
    <a href="https://github.com/CheaperjamRen/leemo/issues">Report an issue</a>
  </p>
  <p>
    <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=flat-square" />
    <img alt="Preview" src="https://img.shields.io/badge/release-preview-ea7c2b?style=flat-square" />
    <img alt="Local first" src="https://img.shields.io/badge/data-local--first-3f7663?style=flat-square" />
    <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-3f7663?style=flat-square" /></a>
  </p>
</div>

![Leemo companion mode](.github/assets/readme/buddy-home.png)

## What is Leemo?

Leemo is a local-first desktop AI agent for people who study or work on a computer and need to move something forward over several days or even a week. It also helps when you are juggling multiple things and want one place to find their progress and results.

The AI inside Leemo is called **momo**. It remembers your preferences and recent context. When you open a local folder, momo also carries the background of that project into the work.

You can begin in companion mode with a question you have not fully worked out. Once the direction is clear, open the relevant local folder and momo can research, use tools, and write the result back into that folder from the workbench. Ideas that come up along the way can go into quick notes and become tasks when you return to Leemo. When the work is finished, its progress and results remain in the original notebook.

A real session can start with a very small action: press `Alt + N` while reading a paper and capture a possible research direction. Back in Leemo, hand the note to momo, work through the question together, and open the paper folder to continue the research. The finished notes stay in the notebook, and the next step appears in the task-and-artifact overview.

## The same momo, in two modes

Companion mode helps you think things through. Tell momo what you have been working on, ask for help with a choice, or add context before taking action.

When you are ready to begin, one click opens the workbench and carries the current context with you. Both modes share the same memory and task data, while the files in a notebook remain organized around the same piece of work.

Under **Settings → Personalization**, you can adjust momo's temperament and relationship style. It continues the conversation using your long-term preferences and the context of the current notebook. As your circumstances change, momo updates what it knows about you. The memory page lists what has been saved, and you can edit or delete any item.

momo may offer a different view, then follows the decision you make.

![momo personalization settings](.github/assets/readme/momo-persona.png)

## Capture it now, organize it when you return

Press `Alt + N` and quick capture appears over your current desktop. Write a note or switch to a to-do. Notes support rich text, checklists, and file attachments, and they save automatically as you type. To-dos can carry a time and reminder, while recurring tasks can be scheduled separately.

momo stays quiet while you capture. Write first, then decide later whether you want it involved.

Back in Leemo, the Today panel brings unprocessed notes and today's tasks together. Recent artifacts are available there too. Put them in order, then hand one of them to momo.

A note can also become the entry point for the next session. Mention it with `@` in a conversation and momo can continue by clarifying the question, researching it, or entering a notebook to act on it. A note does not have to stay a note.

<p align="center"><em>Quick capture design preview</em></p>

![Quick capture design preview](.github/assets/readme/quick-capture-design.png)

## Open a notebook and finish the work

Every “notebook” maps to a real folder on your computer. Open your course materials or a job-search project. Notebooks and conversation history remain on the left, while files open directly on the right. Markdown files support reading, editing, and automatic saving.

Once you give momo a goal, it organizes the task steps and works with files inside the permissions you grant. When outside information is needed, it searches the web and keeps the sources. When a specific page needs attention, it can use the browser and, with permission, operate the Windows desktop.

Sub-agents can split up complex work. Repeated tasks can run on a schedule so you can return later and review the results. PDF and common Office files can also go into a notebook for momo to read or create.

While a task is running, tool activity remains visible in the interface. You can add instructions at any time. Leemo pauses for confirmation before sensitive actions. If an execution fails, you can retry or continue from that point.

Completed files appear in the artifact area and retain a link to their source conversation. The task-and-artifact overview updates automatically, showing how far the work has progressed and which files it produced. Open the notebook again days later and the next step is still clear.

Global search can retrieve past conversations and files or take you straight to an artifact. Formulas and tables render directly in responses, and links to research sources remain available.

<p align="center">
  <img src=".github/assets/readme/web-research.png" width="49%" alt="Web research with retained sources" />
  <img src=".github/assets/readme/rich-answer.png" width="49%" alt="Markdown and formula rendering" />
</p>

## Choose the model you want

Leemo includes connection flows for popular Chinese model providers, as well as international subscriptions and local models. Open **Settings → Models**, sign in to a subscription or enter a key, and test the connection. The model then becomes available in the conversation box. Custom APIs can be connected too.

Different tasks can use different models. Switch whenever the expected quality or your budget calls for it.

When the model changes, the files in each notebook remain where they were. momo's memory and your installed Skills stay in Leemo, so the rest of your workspace does not need to be rebuilt.

## Skill Hub keeps good methods reusable

When you find a method that works, turn it into a Skill for momo. For example, save the steps you use to review a resume; the next time you work on new application materials, momo can follow the same method.

Skill Hub includes Leemo-curated and community Skills, including a hand-curated collection of useful open-source Skills from across the web. Each entry shows what it does, where it came from, and its scan status. Install and enable the Skill you need, then type `/` in the conversation box to call it. Your own Skills can be added from a local folder as well.

![Community Skill Hub](.github/assets/readme/skill-hub-community.png)

## Your files stay local, and you authorize execution

A notebook is the local folder you choose, and generated output is stored there as ordinary files. You can keep editing those files with the software you already use. Moving and delivering them works like any other file.

API keys are protected by Windows secure storage. File changes and command execution follow the current permission level, and the same authorization rules apply when external services are involved. Ask Leemo to confirm key actions, or grant more direct execution for a task with a clear goal.

When you use cloud models, search services, or other third-party tools, the content needed to complete the current task is sent to the corresponding service.

## Download and get started

Leemo currently supports Windows 10/11 x64.

1. Visit the [latest release page](https://github.com/CheaperjamRen/leemo/releases/latest) and download the installer.
2. Start Leemo and connect the model you use under **Settings → Models**.
3. Tell momo what you have been working on. When it is time to act, open a local folder as a notebook.
4. Press `Alt + N` whenever you want to capture an idea or to-do along the way.

Your first message could be:

> I am preparing for graduate recruitment. Learn about my experience and goals first, then help me decide what matters most this week.

Or hand Leemo a file-based task:

> Open these course materials, summarize the key points, and create a three-day study plan in the notebook.

Leemo is currently in preview. The Windows installer does not yet carry a commercial code-signing certificate. If SmartScreen displays a warning, confirm that the file came from this repository's Release page and compare it with the SHA-256 published in the release.

## Feedback and contributions

Open a [GitHub Issue](https://github.com/CheaperjamRen/leemo/issues) to report a problem or share a product suggestion. Remove API keys and private files from public reports. See [SECURITY.md](SECURITY.md) for security-related reports.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing code.

## License

Leemo-owned source code is available under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses or terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
