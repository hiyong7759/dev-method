#!/bin/bash
# Claude Code PreToolUse(Bash) 훅: 여러 세션이 같이 쓰는 저장소를 망가뜨리는 git 명령을 막는다
# 입력: 표준입력의 훅 JSON (tool_input.command). 막으면 종료 코드 2 + 이유를 표준에러로
CMD=$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: print("")')
[ -z "$CMD" ] && exit 0

block() {
  echo "차단: $1 — 여러 세션이 같은 작업 폴더를 쓰므로 금지된 git 명령입니다. 파일 이름을 지정해서 쓰세요 (CLAUDE.md 작업 규칙)." >&2
  exit 2
}
# 앞뒤 구분: 줄 시작, 공백, ; & | ( 뒤에서 git으로 시작
G='(^|[[:space:];&|(])git[[:space:]]+'
E='([[:space:];&|)]|$)'   # 인자의 끝
m() { printf '%s' "$CMD" | grep -Eq "$1"; }

# 검사 우회 표시는 훅 스크립트만 쓴다 (에이전트가 쓰면 커밋 검사를 건너뛰게 됨)
printf '%s' "$CMD" | grep -q "DOCKEEPER=1" && block "DOCKEEPER=1 (커밋 검사 우회)"
m "${G}commit[[:space:]]+([^;&|]*[[:space:]])?(--no-verify|-n)${E}" && block "git commit --no-verify (커밋 검사 우회)"
m "${G}push[[:space:]]+([^;&|]*[[:space:]])?--no-verify${E}" && block "git push --no-verify (검사 우회)"
m "${G}add([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-A|--all)${E}" && block "git add -A"
m "${G}add[[:space:]]+([^;&|]*[[:space:]])?\.${E}" && block "git add ."
m "${G}add[[:space:]]+(-u|--update)[[:space:]]*(\$|[;&|])" && block "git add -u (경로 없음)"
m "${G}reset[[:space:]]+([^;&|]*[[:space:]])?--hard${E}" && block "git reset --hard"
m "${G}stash${E}" && block "git stash"
m "${G}clean${E}" && block "git clean"
m "${G}checkout[[:space:]]+(--[[:space:]]+)?\.${E}" && block "git checkout ."
m "${G}restore[[:space:]]+([^;&|]*[[:space:]])?\.${E}" && block "git restore ."
m "${G}commit[[:space:]]+([^;&|]*[[:space:]])?--amend${E}" && block "git commit --amend"
m "${G}rebase${E}" && block "git rebase"
m "${G}push[[:space:]]+([^;&|]*[[:space:]])?(--force(-with-lease)?|-f)${E}" && block "git push --force"
exit 0
