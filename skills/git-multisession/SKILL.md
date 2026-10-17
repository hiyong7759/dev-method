---
name: git-multisession
description: 위험한 git 명령을 막는 Claude 훅(claude-block-git.sh)을 새 프로젝트에 설치할 때, 또는 이 훅이 명령을 막았을 때 읽는다
---

# 위험한 git 명령 막는 훅

`hooks/claude-block-git.sh`는 `add -A`·`add .`·`add -u`(경로 없음), `commit -a`·`--amend`·`-n`(검사 우회), `reset --hard`, `stash`, `clean`, `checkout .`, `restore .`, `rebase`, `push --force`·`+ref`를 막는다. `git -C`·`git -c` 같은 앞 옵션과 `-am` 같은 합친 옵션도 읽고, 따옴표 안(커밋 메시지)과 heredoc 본문은 명령으로 보지 않는다.

1. 저장소 루트에서 `./install.sh hooks <프로젝트 경로>` — 훅 복사, secret-guard의 git pre-commit 연결, `installed-projects.txt`에 등록
2. 프로젝트 `.claude/settings.json`에 등록:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/tools/hooks/claude-block-git.sh" } ] } ] } }
```

훅은 프로젝트에 복사본으로 있어서 원본을 고치면 낡는다. `./install.sh check`로 어디가 다른지 보고, `./install.sh sync`로 맞춘다.
훅을 고치면 `hooks/test-claude-block-git.sh`를 돌린다. 새로 샌 명령이 나오면 그 사례를 시험에 먼저 더한다.
