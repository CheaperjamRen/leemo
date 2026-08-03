# Security policy

## Supported versions

Leemo is in early preview. Security fixes are applied to the latest commit on
the `main` branch; older snapshots are not maintained as separate release
lines.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected commit, reproduction steps, impact, and the smallest
   safe proof needed to understand the issue.

Do not open a public issue containing API keys, local file contents, OAuth
tokens, personal data, or an exploit against another person's machine. If
private reporting is unavailable, open a public issue that only asks the
maintainer to enable a private contact channel; do not include the vulnerability
details.

## High-priority areas

Reports involving credential exposure, privileged IPC, path traversal, unsafe
Skill or MCP installation, permission bypass, arbitrary command execution, or
silent user-file corruption receive the highest priority.

Leemo connects to user-selected model providers and third-party tools. A remote
service's own outage, pricing, model behavior, or account policy is normally not
a Leemo vulnerability unless Leemo leaks data or crosses a stated permission
boundary.

