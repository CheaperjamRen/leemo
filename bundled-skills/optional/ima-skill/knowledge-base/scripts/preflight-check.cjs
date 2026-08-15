#!/usr/bin/env node
'use strict';

/**
 * Preflight check for uploading a file to IMA Knowledge Base.
 *
 * Validates file type, size, and extracts all metadata needed for
 * create_media and add_knowledge API calls.
 *
 * Resolution priority:
 *   1. If --content-type is provided and recognized → use it (content-type rules over extension)
 *   2. If --content-type is unrecognized, fall back to extension
 *   3. If no --content-type, use extension
 *   4. If neither can resolve → fail
 *
 * Usage:
 *   node preflight-check.cjs --file /path/to/report.pdf
 *   node preflight-check.cjs --file /path/to/downloaded_file --content-type application/pdf
 *
 * Output (JSON, always to stdout):
 *
 *   Pass:
 *   {
 *     "pass": true,
 *     "file_path": "/absolute/path/to/report.pdf",
 *     "file_name": "report.pdf",
 *     "file_ext": "pdf",
 *     "file_size": 123456,
 *     "media_type": 1,
 *     "content_type": "application/pdf"
 *   }
 *
 *   Pass (no extension, content_type provided):
 *   {
 *     "pass": true,
 *     "file_path": "/absolute/path/to/downloaded_file",
 *     "file_name": "downloaded_file",
 *     "file_ext": "",
 *     "file_size": 123456,
 *     "media_type": 1,
 *     "content_type": "application/pdf"
 *   }
 *
 *   Fail:
 *   {
 *     "pass": false,
 *     "file_path": "/absolute/path/to/video.mp4",
 *     "file_name": "video.mp4",
 *     "file_ext": "mp4",
 *     "reason": "Video files (.mp4) are not supported. ..."
 *   }
 *
 * Exit codes:
 *   0 = pass  — file is ready for upload
 *   1 = fail  — file rejected (unsupported type, over size limit, etc.)
 *   2 = error — file not found, usage error, etc.
 */

const fs = require('node:fs');
const path = require('node:path');

// ─── Extension → media_type + content_type ──────────────────────────────────

const EXT_MAP = {
  pdf: { media_type: 1, content_type: 'application/pdf' },
  doc: { media_type: 3, content_type: 'application/msword' },
  docx: { media_type: 3, content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ppt: { media_type: 4, content_type: 'application/vnd.ms-powerpoint' },
  pptx: { media_type: 4, content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  xls: { media_type: 5, content_type: 'application/vnd.ms-excel' },
  xlsx: { media_type: 5, content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { media_type: 5, content_type: 'text/csv' },
  md: { media_type: 7, content_type: 'text/markdown' },
  markdown: { media_type: 7, content_type: 'text/markdown' },
  png: { media_type: 9, content_type: 'image/png' },
  jpg: { media_type: 9, content_type: 'image/jpeg' },
  jpeg: { media_type: 9, content_type: 'image/jpeg' },
  webp: { media_type: 9, content_type: 'image/webp' },
  txt: { media_type: 13, content_type: 'text/plain' },
  xmind: { media_type: 14, content_type: 'application/x-xmind' },
  mp3: { media_type: 15, content_type: 'audio/mpeg' },
  m4a: { media_type: 15, content_type: 'audio/x-m4a' },
  wav: { media_type: 15, content_type: 'audio/wav' },
  aac: { media_type: 15, content_type: 'audio/aac' },
};

// ─── Content-Type → media_type (reverse lookup) ─────────────────────────────

const CONTENT_TYPE_MAP = {};
for (const [, value] of Object.entries(EXT_MAP)) {
  // First entry wins — keeps the canonical content_type per media_type
  if (!CONTENT_TYPE_MAP[value.content_type]) {
    CONTENT_TYPE_MAP[value.content_type] = value.media_type;
  }
}
// Extra aliases not covered by EXT_MAP
Object.assign(CONTENT_TYPE_MAP, {
  'text/x-markdown': 7,
  'application/md': 7,
  'application/markdown': 7,
  'application/vnd.xmind.workbook': 14,
  'application/zip': 14, // xmind can be zip
});

// ─── Size limits by media_type (bytes) ──────────────────────────────────────

const MB = 1024 * 1024;
const SIZE_LIMITS = {
  5: 10 * MB, // Excel / CSV
  7: 10 * MB, // Markdown
  13: 10 * MB, // TXT
  14: 10 * MB, // Xmind
  9: 30 * MB, // Image
};
const DEFAULT_SIZE_LIMIT = 200 * MB; // PDF, Word, PPT, Audio, etc.

// ─── Explicitly unsupported extensions ──────────────────────────────────────

const UNSUPPORTED_VIDEO_EXT = new Set(['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'rmvb', 'rm', '3gp']);

const UNSUPPORTED_VIDEO_CT = new Set([
  'video/mp4',
  'video/x-msvideo',
  'video/quicktime',
  'video/x-matroska',
  'video/x-ms-wmv',
  'video/x-flv',
  'video/webm',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function fail(result) {
  console.log(JSON.stringify({ pass: false, ...result }));
  process.exit(1);
}

function formatSize(bytes) {
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

// ─── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].replace(/^--/, '')] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);

if (!args.file) {
  console.error('Usage: node preflight-check.cjs --file <path> [--content-type <mime>]');
  process.exit(2);
}

const filePath = path.resolve(args.file);
const fileName = path.basename(filePath);
const extMatch = fileName.match(/\.([^.]+)$/);
const ext = extMatch ? extMatch[1].toLowerCase() : '';
const inputContentType = args['content-type'] || '';

const base = { file_path: filePath, file_name: fileName, file_ext: ext };

// 1. Check file exists
let stat;
try {
  stat = fs.statSync(filePath);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  throw err;
}

// 2. Check not an unsupported video type (by ext or content-type)
if (UNSUPPORTED_VIDEO_EXT.has(ext)) {
  fail({ ...base, reason: `Video files (.${ext}) are not supported. Only supported in IMA desktop app.` });
}
if (UNSUPPORTED_VIDEO_CT.has(inputContentType)) {
  fail({ ...base, reason: `Video files (${inputContentType}) are not supported. Only supported in IMA desktop app.` });
}

// 3. Resolve media_type and content_type
//    Priority: content-type first, then fall back to extension
let mediaType = null;
let contentType = null;

const ctMediaType = inputContentType ? CONTENT_TYPE_MAP[inputContentType] : undefined;
const extMapping = ext ? EXT_MAP[ext] : undefined;

if (ctMediaType != null) {
  // Content-type recognized — always wins
  mediaType = ctMediaType;
  contentType = inputContentType;
} else if (inputContentType) {
  // Content-type provided but unrecognized — try extension fallback
  if (extMapping) {
    mediaType = extMapping.media_type;
    contentType = extMapping.content_type;
  } else {
    fail({
      ...base,
      reason: `Unrecognized content type ${inputContentType}${ext ? ` and file extension .${ext}` : ''}. This file type is not supported.`,
    });
  }
} else {
  // No content-type provided — fall back to extension
  if (extMapping) {
    mediaType = extMapping.media_type;
    contentType = extMapping.content_type;
  } else if (ext) {
    fail({ ...base, reason: `Unrecognized file extension .${ext}. This file type is not supported.` });
  } else {
    fail({ ...base, reason: 'File has no extension and no --content-type provided. Cannot determine file type.' });
  }
}

// 4. Check file size
const fileSize = stat.size;
const sizeLimit = SIZE_LIMITS[mediaType] || DEFAULT_SIZE_LIMIT;

if (fileSize > sizeLimit) {
  fail({
    ...base,
    file_size: fileSize,
    media_type: mediaType,
    content_type: contentType,
    reason: `File size ${formatSize(fileSize)} exceeds the ${formatSize(sizeLimit)} limit for this file type.`,
  });
}

// 5. All checks passed
console.log(
  JSON.stringify({
    pass: true,
    ...base,
    file_size: fileSize,
    media_type: mediaType,
    content_type: contentType,
  }),
);
process.exit(0);
