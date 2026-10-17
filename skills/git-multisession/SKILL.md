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

`hooks/claude-block-git.sh`는 `add -A`·`add .`·`add -u`(경로 없음), `commit -a`·`--amend`·`-n`(검사 우회), `reset --hard`, `stash`, `clean`, `checkout .`, `restore .`, `rebase`, `push --force`·`+ref`를 막는다. `git -C`·`git -c` 같은 앞 옵션과 `-am` 같은 합친 옵션도 읽고, 따옴표 안(커밋 메시지)과 heredoc 본문은 명령으로 보지 않는다.

1. 저장소 루트에서 `./install.sh hooks <프로젝트 경로>` — 훅 복사, secret-guard의 git pre-commit 연결, `installed-projects.txt`에 등록
2. 프로젝트 `.claude/settings.json`에 등록:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/tools/hooks/claude-block-git.sh" } ] } ] } }
```

훅은 프로젝트에 복사본으로 있어서 원본을 고치면 낡는다. `./install.sh check`로 어디가 다른지 보고, `./install.sh sync`로 맞춘다.
훅을 고치면 `hooks/test-claude-block-git.sh`를 돌린다. 새로 샌 명령이 나오면 그 사례를 시험에 먼저 더한다.
