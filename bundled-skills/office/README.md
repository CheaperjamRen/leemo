# 可选 Office 技能包入口

Leemo 自带基础文档工具。这里额外保留一个**本地、可选、不会进入公开 Git**
的高级 Office 技能挂载点，供产品维护者在拥有合法分发权时制作完整安装包。
构建过程不会从 GitHub 或其他在线来源下载这份内容。

在构建安装包前，把已经确认许可与来源的四个技能目录放到唯一发布入口：

推荐布局：

```text
bundled-skills/office/release/skills/docx/SKILL.md
bundled-skills/office/release/skills/xlsx/SKILL.md
bundled-skills/office/release/skills/pptx/SKILL.md
bundled-skills/office/release/skills/pdf/SKILL.md
```

`release` 必须且只能包含 `skills`，`skills` 必须且只能包含这四个目录。
构建校验会拒绝额外目录、staging 副本、链接、依赖目录和缓存文件，避免把
临时副本或不可移植路径带进安装包。

每个目录可以包含自己的脚本、参考资料和许可证文件。Leemo 会在启动时
校验四个目录都存在，再按内容版本原子复制到 appData 的真实运行目录供
Agent 加载；源目录不会被修改。缺少任何一个
目录时，程序会保留基础文档工具，并在技能页明确提示 Office 技能包未就绪。

`electron-builder` 会在目录存在时把 `release` 放进 `app.asar`，避免安装阶段
展开数百个小文件。首次启动只在内容版本变化时展开到 appData，因此用户可
离线使用，不需要首启访问 GitHub。

公开源码构建（允许没有这份可选包）：

```text
npm run electron:pack
```

需要保证高级 Office 包完整的产品构建：

```text
npm run verify:office-bundle
npm run verify:office-runtime
npm run electron:pack:with-office
```

第一条验证技能文件是否完整并输出树哈希；第二条会实际生成临时 Office
样本并调用随包脚本。注意：技能文件离线存在不代表 Python、LibreOffice、
Pandoc、Poppler 等执行依赖已经随 Leemo 提供，第二条在完整运行环境未就绪时
会有意返回非零，防止把“能加载 Skill”误报成“完整无损 Office 已打通”。
