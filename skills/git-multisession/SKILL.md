---
name: git-multisession
description: 여러 Claude 세션이 같은 작업 폴더와 같은 git 스테이징을 쓸 때 커밋하는 법과 위험한 git 명령을 막는 훅. 그런 프로젝트에서 git add·commit을 하기 전, 또는 새 프로젝트에 이 보호 장치를 설치할 때 읽는다
---

# 여러 세션이 한 폴더를 쓸 때의 git

## 커밋

- 자기가 고친 파일만 이름을 지정해 add 한다 (`git add -A`, `git add .`은 다른 세션 변경까지 섞는다)
- 커밋도 파일을 지정한다: `git commit -m "…" -- 파일1 파일2`. `git add` 뒤 그냥 `git commit`을 하면 다른 세션이 스테이징에 올려 둔 파일까지 딸려 들어간다
- `.git/index.lock` 때문에 실패하면 다른 세션이 커밋 중이다. 잠금 파일을 지우지 말고 몇 초 기다렸다 다시 한다
- 시작 전에 다른 세션의 작업을 본다: `git status --short; git log --oneline -5`

## 훅 설치 (새 프로젝트)

`hooks/claude-block-git.sh`는 `add -A`, `add .`, `reset --hard`, `stash`, `clean`, `checkout .`, `restore .`, `commit --amend`, `rebase`, `push --force`를 막는다.

1. 프로젝트의 `tools/hooks/`로 복사하고 실행 권한을 준다
2. 프로젝트 `.claude/settings.json`에 등록:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/tools/hooks/claude-block-git.sh" } ] } ] } }
```
