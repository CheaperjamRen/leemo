# Knowledge Base (知识库)

> Prerequisites: see root `../SKILL.md` for setup, credentials, and `ima_api()` helper.

API base path: `openapi/wiki/v1`

通过 IMA Wiki OpenAPI 管理用户知识库，支持上传文件、添加网页链接、搜索知识库内容、浏览知识库列表和获取知识库详情。

完整的数据结构和接口参数详见 `references/api.md`。

## 接口决策表

| 用户意图                                      | 调用接口                                                               | 关键参数                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 上传文件到知识库                              | `check_repeated_names` → `create_media` → COS Upload → `add_knowledge` | `media_type`（按扩展名），`knowledge_base_id`，`file_name`，`file_size`  |
| 上传文件到知识库的某个文件夹                  | 先定位文件夹 → 同上（`folder_id` 传入目标文件夹 ID）                   | 见「文件夹操作」章节                                                     |
| 添加网页/微信文章到知识库                     | `import_urls`                                                          | `urls`（1-10 个），`knowledge_base_id`，可选 `folder_id`（省略则根目录） |
| 添加笔记到知识库                              | `add_knowledge`                                                        | `media_type=11`，`note_info.content_id=<doc_id>`，`knowledge_base_id`    |
| 添加 URL（文件型）到知识库                    | `check_repeated_names` → 下载文件 → 走"上传文件"流程                   | URL 指向 PDF/Word/PPT 等文件时，按文件方式处理                           |
| 检查文件名是否重复                            | `check_repeated_names`                                                 | `params[].name`，`params[].media_type`，`knowledge_base_id`，`folder_id` |
| 获取知识库信息                                | `get_knowledge_base`                                                   | `ids`（1-20 个，不重复）                                                 |
| 浏览知识库内容列表 / 浏览文件夹               | `get_knowledge_list`                                                   | `knowledge_base_id`，`cursor`，`limit`(1~50)，可选 `folder_id`           |
| 在知识库中搜索（含文件和文件夹）              | `search_knowledge`                                                     | `query`，`knowledge_base_id`，`cursor`                                   |
| 按关键词查找知识库（用户知道名字但不知道 ID） | `search_knowledge_base`                                                | `query`，`cursor`，`limit`(1~50)                                         |
| 查看/了解自己有哪些知识库                     | `search_knowledge_base`（`query` 传空字符串）                          | `query: ""`，`cursor`，`limit`(1~50)                                     |
| 添加内容但**未指定**目标知识库                | `get_addable_knowledge_base_list` → 展示列表让用户选择                 | `cursor`，`limit`(1~50)                                                  |

### `search_knowledge_base` vs `get_addable_knowledge_base_list` 选择指南

这两个接口容易混淆，选择规则：

| 场景                                             | 使用接口                                       | 原因                               |
| ------------------------------------------------ | ---------------------------------------------- | ---------------------------------- |
| 用户说了知识库名称（如"添加到产品文档库"）       | `search_knowledge_base`                        | 按名称搜索，找到 ID 后继续操作     |
| 用户想浏览/了解某个知识库                        | `search_knowledge_base` → `get_knowledge_base` | 先搜到 ID，再获取详情              |
| 用户想查看自己有哪些知识库（无具体关键词）       | `search_knowledge_base`（`query: ""`）         | 空 query 返回用户的所有知识库列表  |
| 用户要添加内容但**没说添加到哪个知识库**         | `get_addable_knowledge_base_list`              | 列出有权限添加的知识库，让用户选择 |
| 用户说"添加到知识库"但上下文中无法确定哪个知识库 | `get_addable_knowledge_base_list`              | 同上，不要猜测，让用户选择         |

**绝不要**在用户已明确指定知识库名称时调用 `get_addable_knowledge_base_list`，直接用 `search_knowledge_base` 按名称搜索即可。

## 文件类型检测

使用 `scripts/preflight-check.cjs` 脚本自动完成类型检测和大小校验。脚本按以下优先级解析：

1. **`--content-type` 已提供且可识别** → content-type 优先，直接使用
2. **`--content-type` 不可识别** → 回退到扩展名
3. **未提供 `--content-type`** → 使用扩展名
4. **两者都无法识别** → 拒绝处理

```bash
# 有扩展名（自动推断）
node .claude/skills/ima-skill/knowledge-base/scripts/preflight-check.cjs --file report.pdf

# 无扩展名或扩展名不可识别（需传入 content-type，如从 HTTP HEAD 获取）
node .claude/skills/ima-skill/knowledge-base/scripts/preflight-check.cjs --file downloaded_file --content-type application/pdf
```

扩展名与类型的对应关系：

| 扩展名              | media_type | content_type                                                                 |
| ------------------- | ---------- | ---------------------------------------------------------------------------- |
| `.pdf`              | 1          | `application/pdf`                                                            |
| `.doc`              | 3          | `application/msword`                                                         |
| `.docx`             | 3          | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`    |
| `.ppt`              | 4          | `application/vnd.ms-powerpoint`                                              |
| `.pptx`             | 4          | `application/vnd.openxmlformats-officedocument.presentationml.presentation`  |
| `.xls`              | 5          | `application/vnd.ms-excel`                                                   |
| `.xlsx`             | 5          | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`          |
| `.csv`              | 5          | `text/csv`                                                                   |
| `.md` / `.markdown` | 7          | `text/markdown`                                                              |
| `.png`              | 9          | `image/png`                                                                  |
| `.jpg` / `.jpeg`    | 9          | `image/jpeg`                                                                 |
| `.webp`             | 9          | `image/webp`                                                                 |
| `.txt`              | 13         | `text/plain`                                                                 |
| `.xmind`            | 14         | `application/x-xmind` / `application/vnd.xmind.workbook` / `application/zip` |
| `.mp3`              | 15         | `audio/mpeg`                                                                 |
| `.m4a`              | 15         | `audio/x-m4a`                                                                |
| `.wav`              | 15         | `audio/wav`                                                                  |
| `.aac`              | 15         | `audio/aac`                                                                  |

未识别的扩展名或无扩展名：**直接告知用户该文件类型不被支持，立即终止操作**。不要猜测或默认为某个类型，**不要询问用户是否仍要上传**。

> **不支持的类型**：视频文件（`.mp4`、`.avi`、`.mov` 等）、Bilibili（`bilibili.com/video/`）和 YouTube（`youtube.com/watch`）链接、本地 HTML 文件（`file://`）**无法**通过 skill 添加到知识库。直接告知用户「该文件类型不支持，仅支持在 ima 桌面端内添加进知识库」，**不要提供上传选项或询问是否继续**。

## URL 类型检测

添加 URL 到知识库时，需要根据 URL 模式和 Content-Type 判断类型。检测按以下优先级进行：

**1. Content-Type 为 `text/html` 时，按 URL 模式区分：**

| URL 模式                                            | media_type | 类型           | 处理方式                                                  |
| --------------------------------------------------- | ---------- | -------------- | --------------------------------------------------------- |
| 匹配 `mp.weixin.qq.com/s/` 或 `mp.weixin.qq.com/s?` | 6          | 微信公众号文章 | 使用 `import_urls`                                        |
| 以 `https://www.bilibili.com/video/` 开头           | ❌ 16      | 视频网页       | **不支持**，告知用户「仅支持在 ima 桌面端内添加进知识库」 |
| 以 `https://www.youtube.com/watch` 开头             | ❌ 16      | 视频网页       | **不支持**，告知用户「仅支持在 ima 桌面端内添加进知识库」 |
| 以 `file://` 开头                                   | ❌         | 本地 HTML      | **不支持**，告知用户「仅支持在 ima 桌面端内添加进知识库」 |
| 其他 `text/html` 页面                               | 2          | 普通网页       | 使用 `import_urls`                                        |

**2. Content-Type 为文件类型时：** 按文件类型检测表处理（PDF、Word、Excel 等）。

**3. 其他：** 告知用户该类型不被支持。

## 添加前置检查（Pre-flight Check）

在执行任何添加知识到知识库的操作前（`add_knowledge`、`import_urls`、上传文件流程），**必须按以下顺序逐项检查**，任一项不通过则**立即终止并告知用户，不要询问是否仍要尝试上传**：

### 1. 类型支持检查

| 检查项             | 条件                                                                      | 不通过时的处理                                |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| 文件扩展名是否支持 | 扩展名不在「文件类型检测」表中                                            | 告知用户该文件类型不被支持                    |
| 视频文件           | `.mp4`、`.avi`、`.mov` 等视频扩展名                                       | 告知用户「仅支持在 ima 桌面端内添加进知识库」 |
| 视频网页 URL       | `https://www.bilibili.com/video/` 或 `https://www.youtube.com/watch` 开头 | 告知用户「仅支持在 ima 桌面端内添加进知识库」 |
| 本地 HTML 文件     | `file://` 协议                                                            | 告知用户「仅支持在 ima 桌面端内添加进知识库」 |

### 2. 文件大小检查

上传前必须校验文件大小，超限文件应**在上传前拦截**，不要发起请求：

| 文件类型                    | media_type  | 最大大小 |
| --------------------------- | ----------- | -------- |
| Excel、TXT、Xmind、Markdown | 5/13/14/7   | 10 MB    |
| 图片                        | 9           | 30 MB    |
| PDF、Word、PPT、音频及其他  | 1/3/4/15 等 | 200 MB   |

### 3. 音频时长检查

音频文件（media_type=15）额外限制：**最长 2 小时**。超过时告知用户。

### 4. 文件名重复检查

仅适用于文件类型（media_type 1/3/4/5/7/9/13/14/15），不适用于网页（2/6）、笔记（11）等：

- 调用 `check_repeated_names` 检查
- `is_repeated=true`：询问用户是否保留两者（追加时间戳）或取消
- 不支持"替换"操作

> **检查顺序很重要**：先做类型和大小检查（本地即可判断），通过后再调用远程接口检查重名。避免对不支持或超限的文件发起不必要的网络请求。

## 常用工作流

### 上传文件到知识库

完成「添加前置检查」后，执行以下步骤：创建媒体 → 上传 COS → 添加知识。

> 前置检查（类型检测、大小校验、重名检查）见「添加前置检查」章节。

```bash
# 1. 前置检查 — 类型、大小一步完成
#    有扩展名时：自动从扩展名推断 media_type 和 content_type
#    无扩展名时：需通过 --content-type 传入（如从 HTTP HEAD 获取）
PREFLIGHT=$(node .claude/skills/ima-skill/knowledge-base/scripts/preflight-check.cjs \
  --file "/path/to/report.pdf")
echo "$PREFLIGHT"
# pass=false 时直接终止，将 reason 展示给用户

# 2. 从 preflight 结果提取字段（用于后续 API 调用）
FILE_NAME=$(echo "$PREFLIGHT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.file_name)")
FILE_EXT=$(echo "$PREFLIGHT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.file_ext)")
FILE_SIZE=$(echo "$PREFLIGHT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.file_size))")
MEDIA_TYPE=$(echo "$PREFLIGHT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.media_type))")
CONTENT_TYPE=$(echo "$PREFLIGHT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.content_type)")

# 3. 重名检查（仅文件类型，见「添加前置检查」第 4 步）

# 4. create_media — 获取 media_id 和 COS 上传凭证
ima_api "openapi/wiki/v1/create_media" "{
  \"file_name\": \"$FILE_NAME\",
  \"file_size\": $FILE_SIZE,
  \"content_type\": \"$CONTENT_TYPE\",
  \"knowledge_base_id\": \"<kb_id>\",
  \"file_ext\": \"$FILE_EXT\"
}"
# 从返回值提取 media_id 和 cos_credential 各字段

# 5. 上传文件到 COS
node .claude/skills/ima-skill/knowledge-base/scripts/cos-upload.cjs \
  --file "/path/to/report.pdf" \
  --secret-id "<cos_credential.secret_id>" \
  --secret-key "<cos_credential.secret_key>" \
  --token "<cos_credential.token>" \
  --bucket "<cos_credential.bucket_name>" \
  --region "<cos_credential.region>" \
  --cos-key "<cos_credential.cos_key>" \
  --content-type "$CONTENT_TYPE" \
  --start-time "<cos_credential.start_time>" \
  --expired-time "<cos_credential.expired_time>"

# 6. add_knowledge — 将已上传的文件关联到知识库
ima_api "openapi/wiki/v1/add_knowledge" "{
  \"media_type\": $MEDIA_TYPE,
  \"media_id\": \"<media_id>\",
  \"title\": \"$FILE_NAME\",
  \"knowledge_base_id\": \"<kb_id>\",
  \"file_info\": {
    \"cos_key\": \"<cos_credential.cos_key>\",
    \"file_size\": $FILE_SIZE,
    \"file_name\": \"$FILE_NAME\"
  }
}"
```

#### 批量上传时的重复处理

当上传多个文件时，可一次性检查所有文件名（最多 2000 个）：

```bash
# 批量检查
ima_api "openapi/wiki/v1/check_repeated_names" '{
  "params": [
    {"name": "report.pdf", "media_type": 1},
    {"name": "slides.pptx", "media_type": 4},
    {"name": "data.xlsx", "media_type": 5}
  ],
  "knowledge_base_id": "<kb_id>",
  "folder_id": "<folder_id>"
}'
# 注意：如果是根目录，省略 folder_id 字段
# 遍历 results，对 is_repeated=true 的文件询问用户：
# - "以下文件在知识库中已存在同名文件：report.pdf、data.xlsx。是否保留两者？（不支持替换）"
# - 用户选择"保留两者"的文件：追加时间戳后继续上传
# - 用户选择"取消"的文件：从上传列表中移除
```

**时间戳命名规则**：在文件名（不含扩展名）末尾追加 `_YYYYMMDDHHmmss`，例如 `report_20260317153000.pdf`。

### 添加网页/微信文章到知识库

使用 `import_urls` 批量导入网页和微信公众号文章（1-10 个 URL），服务端自动识别类型：

```bash
# 添加到根目录（不传 folder_id）
ima_api "openapi/wiki/v1/import_urls" '{
  "knowledge_base_id": "<kb_id>",
  "urls": [
    "https://example.com/article",
    "https://mp.weixin.qq.com/s/xxxxx"
  ]
}'

# 添加到指定文件夹（传 folder_id，以 folder_ 开头）
ima_api "openapi/wiki/v1/import_urls" '{
  "knowledge_base_id": "<kb_id>",
  "folder_id": "<folder_id>",
  "urls": [
    "https://example.com/article"
  ]
}'
# 返回 results 映射：{ "<url>": { url, ret_code, media_id } }
# ret_code=0 表示成功，非 0 查看 errmsg
```

### 添加笔记到知识库

将已有笔记（通过 `doc_id` 引用）直接关联到知识库，无需下载内容：

```bash
ima_api "openapi/wiki/v1/add_knowledge" '{
  "media_type": 11,
  "note_info": { "content_id": "<doc_id>" },
  "title": "笔记标题",
  "knowledge_base_id": "<kb_id>"
}'
```

### 添加 URL 到知识库（自动检测文件型 URL）

当用户提供 URL 时，需先判断该 URL 指向的是网页还是可下载文件（PDF、Word、PPT 等）。

**判断规则**（按优先级）：

1. **URL 路径包含文件扩展名**：如 `https://arxiv.org/pdf/2603.12268` 以 `/pdf/` 开头，或 `https://example.com/report.pdf` 以 `.pdf` 结尾 → 文件型
2. **发送 HEAD 请求检查 Content-Type**：`curl -sI -L <url>` 查看响应头
   - `application/pdf` → PDF 文件
   - `application/msword` 或 `application/vnd.openxmlformats-*` → Word/PPT/Excel 文件
   - `text/html` → 网页
3. **已知文件型 URL 模式**：
   - `arxiv.org/pdf/*` → PDF
   - `*.pdf`、`*.docx`、`*.pptx`、`*.xlsx` 结尾 → 对应文件类型
   - GitHub raw 文件链接 → 按扩展名判断

**文件型 URL 处理流程**：

```bash
# 1. 探测 URL 类型
CONTENT_TYPE=$(curl -sI -L "https://arxiv.org/pdf/2603.12268" | grep -i "^content-type:" | tail -1 | awk '{print $2}' | tr -d '\r')
# 结果如 application/pdf → 文件型

# 2. 下载文件到临时目录
TEMP_DIR=$(mktemp -d)
# 根据 Content-Type 或 URL 推断文件名和扩展名
curl -sL -o "$TEMP_DIR/paper.pdf" "https://arxiv.org/pdf/2603.12268"

# 3. 前置检查（传入 content-type 作为备用，文件名有扩展名时会优先用扩展名）
PREFLIGHT=$(node .claude/skills/ima-skill/knowledge-base/scripts/preflight-check.cjs \
  --file "$TEMP_DIR/paper.pdf" --content-type "$CONTENT_TYPE")
echo "$PREFLIGHT"
# pass=false 时直接终止

# 4. 按"上传文件到知识库"流程处理：create_media → COS Upload → add_knowledge
# （参见上方"上传文件到知识库"工作流）

# 5. 清理临时文件
rm -rf "$TEMP_DIR"
```

**文件名推断**：

- 优先从 `Content-Disposition` 响应头提取文件名
- 其次从 URL 路径中提取（如 `/pdf/2603.12268` → `2603.12268.pdf`）
- 最后使用 URL 的最后一段路径 + 根据 Content-Type 补充扩展名

### 文件夹操作

知识库内容以文件夹结构组织。**文件夹本身也是一种知识条目**，在 `get_knowledge_list` 和 `search_knowledge` 的返回结果中会同时包含文件和文件夹。

#### 核心概念

- `folder_id`：文件夹的唯一标识，**始终以 `folder_` 前缀开头**（如 `folder_abc123`），在 `add_knowledge`、`import_urls`、`get_knowledge_list`、`check_repeated_names` 等接口中用于指定目标文件夹
- **操作根目录时，不要传 `folder_id` 参数**（直接省略该字段），不要将 `knowledge_base_id` 作为 `folder_id` 传入
- `get_knowledge_list` 返回的 `current_path`（`FolderInfo[]`）表示当前浏览位置的完整路径（面包屑）

#### 定位文件夹（用户提到文件夹名时）

当用户说「添加到 XX 文件夹」但只给了文件夹名称时，需要先找到 `folder_id`：

```bash
# 方法 1：搜索知识库内容（推荐，可直接按名称搜索文件夹）
ima_api "openapi/wiki/v1/search_knowledge" '{
  "query": "文件夹名称",
  "knowledge_base_id": "<kb_id>",
  "cursor": ""
}'
# 从返回的 info_list 中找到匹配的文件夹条目，取其 media_id 作为 folder_id

# 方法 2：浏览根目录列表逐级查找
ima_api "openapi/wiki/v1/get_knowledge_list" '{
  "knowledge_base_id": "<kb_id>",
  "cursor": "",
  "limit": 50
}'
# 从返回的 knowledge_list 中找到目标文件夹，取其 media_id 作为 folder_id
# 如果文件夹在子目录中，需要用返回的 folder_id 逐级深入
```

#### 添加内容到指定文件夹

所有写入接口（`add_knowledge`、`import_urls`、`check_repeated_names`）都支持 `folder_id` 参数：

```bash
# 上传文件到指定文件夹
ima_api "openapi/wiki/v1/add_knowledge" '{
  "media_type": 1,
  "media_id": "<media_id>",
  "title": "report.pdf",
  "knowledge_base_id": "<kb_id>",
  "folder_id": "<folder_id>",
  "file_info": { "cos_key": "...", "file_size": 12345, "file_name": "report.pdf" }
}'

# 导入网页到指定文件夹
ima_api "openapi/wiki/v1/import_urls" '{
  "knowledge_base_id": "<kb_id>",
  "folder_id": "<folder_id>",
  "urls": ["https://example.com/article"]
}'

# 添加到根目录时，直接省略 folder_id
ima_api "openapi/wiki/v1/add_knowledge" '{
  "media_type": 1,
  "media_id": "<media_id>",
  "title": "report.pdf",
  "knowledge_base_id": "<kb_id>",
  "file_info": { "cos_key": "...", "file_size": 12345, "file_name": "report.pdf" }
}'
```

### 获取知识库信息

```bash
ima_api "openapi/wiki/v1/get_knowledge_base" '{"ids": ["<kb_id>"]}'
# 返回 infos 映射：{ "<kb_id>": { id, name, cover_url, description, recommended_questions } }
```

### 浏览知识库内容

```bash
# 浏览根目录
ima_api "openapi/wiki/v1/get_knowledge_list" '{"knowledge_base_id": "<kb_id>", "cursor": "", "limit": 20}'

# 浏览指定文件夹
ima_api "openapi/wiki/v1/get_knowledge_list" '{"knowledge_base_id": "<kb_id>", "folder_id": "<folder_id>", "cursor": "", "limit": 20}'
# 翻页：用 next_cursor，is_end=true 时停止
```

### 在知识库中搜索

```bash
ima_api "openapi/wiki/v1/search_knowledge" '{"query": "搜索关键词", "knowledge_base_id": "<kb_id>", "cursor": ""}'
```

### 搜索知识库列表

```bash
# 按关键词搜索
ima_api "openapi/wiki/v1/search_knowledge_base" '{"query": "搜索关键词", "cursor": "", "limit": 20}'

# 查看所有知识库（空 query）
ima_api "openapi/wiki/v1/search_knowledge_base" '{"query": "", "cursor": "", "limit": 20}'
```

### 获取可添加的知识库列表

**仅当用户要添加内容但未指定目标知识库时使用**。如果用户已给出知识库名称，应使用 `search_knowledge_base` 按名称搜索，而非此接口。

```bash
# 首次请求
ima_api "openapi/wiki/v1/get_addable_knowledge_base_list" '{"cursor": "", "limit": 20}'
# 翻页：用 next_cursor，is_end=true 时停止
```

## 核心响应字段

知识条目（`KnowledgeInfo`）关键字段：`media_id`（媒体ID）、`title`、`parent_folder_id`。

搜索到的知识条目（`SearchedKnowledgeInfo`）关键字段：`media_id`、`title`、`parent_folder_id`、`highlight_content`（高亮内容，内容匹配时返回）。

知识库信息（`KnowledgeBaseInfo`）关键字段：`id`、`name`、`cover_url`、`description`、`recommended_questions`。

文件夹条目（`FolderInfo`）关键字段：`folder_id`、`name`、`file_number`、`folder_number`、`parent_folder_id`、`is_top`。

完整字段定义见 `references/api.md`。

## 分页

所有列表和搜索接口使用**游标分页**：

1. 首次请求：`cursor: ""`
2. 检查返回的 `is_end`：`false` 表示还有更多数据
3. 将返回的 `next_cursor` 作为下次请求的 `cursor`
4. `is_end = true` 时停止翻页

## 响应处理

所有 API 返回统一结构 `{ "retcode": 0, "errmsg": "...", "data": { ... } }`：

- `retcode=0`：成功，从 `data` 提取业务字段
- `retcode≠0`：失败，**直接将 `errmsg` 展示给用户**即可，不需要自行翻译错误码

## 用户体验

- **隐藏内部 ID**：面向用户的展示中**永远不要暴露 `knowledge_base_id`、`media_id`、`folder_id` 等内部 ID**。始终使用知识库名称、文件标题、文件夹名称等用户可读信息。ID 仅用于后续 API 调用，不展示给用户。
  - ✅ `"已添加到知识库「产品文档库」✓"`
  - ❌ `"已添加到知识库 abc123def456 ✓"`
  - 需要引用知识库时，先通过 `get_knowledge_base` 获取名称，再展示
- **精简进度**：不要逐步暴露内部操作（如"正在创建媒体…正在上传 COS…"）。只报告用户关心的信息：
  - 上传文件：`"正在上传 report.pdf…"` → `"已添加到知识库「产品文档库」✓"`
  - 添加网页：`"正在添加…"` → `"已添加到「产品文档库」✓"`
  - 失败时展示 `errmsg` 即可
- **批量操作**：汇总结果，如 `"3 个文件已添加到「产品文档库」，1 个失败（data.xlsx: 文件大小超限）"`
- **格式化展示**：读取类操作的结果应以结构化格式展示给用户，而非原始 JSON：

  **知识库列表**（`search_knowledge_base` / `get_addable_knowledge_base_list`）：

  > 搜索知识库后，用返回的 ID 列表调用 `get_knowledge_base` 获取描述信息，一并展示。

  ```
  📚 搜索结果（共 3 个知识库）：
  1. **产品文档库** — 存放产品相关的所有文档资料
  2. **技术方案库** — 各项目技术方案汇总
  3. **竞品分析库**
  ```

  **知识库内容列表**（`get_knowledge_list`）：

  ```
  📂 知识库「产品文档库」内容：
  📁 设计文档/          (3 个文件, 1 个子文件夹)
  📁 会议纪要/          (12 个文件)
  📄 产品需求文档.pdf
  📄 技术方案.docx
  📄 数据分析.xlsx
  --- 第 1 页，还有更多内容 ---
  ```

  **搜索结果**（`search_knowledge`）：

  > `search_knowledge` 返回的条目包含 `media_id`、`title`、`parent_folder_id`、`highlight_content`（内容匹配时返回高亮片段），

  ```
  🔍 在知识库「产品文档库」中搜索「排期」的结果：

  1. 📄 Q1排期表.xlsx (文件夹: 项目管理/)
     > ...包含**排期**计划的详细信息...
  2. 📄 开发排期讨论.pdf (文件夹: 会议纪要/)
  3. 📁 排期模板/ (文件夹: 根目录)
  ```

  **知识库详情**（`get_knowledge_base`）：

  ```
  📚 产品文档库
  📝 描述：存放产品相关的所有文档资料
  💡 推荐问题：
     - 最新的产品需求是什么？
     - 技术方案有哪些？
  ```

## 注意事项

- `get_knowledge_base` 接受 1-20 个 ID；单个 ID 也需包装为数组
- `get_knowledge_list` 的 `limit` 范围为 1~50
- **文件夹是知识条目的一种**：`get_knowledge_list` 和 `search_knowledge` 的返回结果中同时包含文件和文件夹，需通过字段区分（文件夹有 `folder_id`/`name`/`file_number`/`folder_number`，文件有 `media_id`/`title`）
- **用户提到文件夹时**：如果用户只给了文件夹名称（而非 ID），必须先通过 `search_knowledge` 或 `get_knowledge_list` 找到对应的 `folder_id`，再执行后续操作
- `folder_id` 在 `add_knowledge`、`import_urls`、`get_knowledge_list`、`check_repeated_names` 中均为可选字段，**操作根目录时直接省略 `folder_id`，不要传该参数**。`folder_id` 的值始终以 `folder_` 前缀开头（如 `folder_abc123`），**不要将 `knowledge_base_id` 作为 `folder_id` 传入**
- **文件上传时 `title` 必须等于 `file_name`**：调用 `add_knowledge` 添加文件时，`title` 字段**必须使用文件的原始完整文件名（含扩展名）**，不要自行拟定标题。`file_name` 和 `title` 传同一个值。**禁止缩短、翻译、重命名或省略任何部分**。例如文件名为 `音频.mp3`，则 `file_name` 和 `title` 都必须传 `音频.mp3`
- 文件扩展名必须正确提取，用于 `media_type` 检测和 `file_ext` 字段（无点号，如 `pdf`）
- COS 上传脚本失败（非零退出码）时，不要继续调用 `add_knowledge`
- COS 上传时 `--content-type` 应传入文件的实际 MIME 类型（如 `application/pdf`），而非通用的 `application/octet-stream`
- 当用户提供 URL 添加到知识库时，必须先检测 URL 是否指向文件（通过 URL 路径扩展名 + HEAD 请求 Content-Type），文件型 URL 需下载后走上传流程；网页/微信文章型 URL 使用 `import_urls`
