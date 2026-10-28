#!/bin/bash
# claude-block-nonowner.sh 시험: 담당이 아닌 세션(환경 없음)은 늘 통과, 원본이 아닌 담당은 워크트리·브랜치·커밋·요청 명령이 종료 코드 2, 원본은 통과
HOOK="$(cd "$(dirname "$0")" && pwd)/claude-block-nonowner.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d)
mkdir -p "$T/.spec" "$T/src"
echo '{"src":"src","wake":true}' > "$T/.spec/config.json"
echo '{"ORIG-1":{"request":7,"seen":"","origin":true}}' > "$T/.spec/sessions.json"
fail=0
check() { # 기대 종료코드, 세션 번호, 도구, 명령, 담당 환경(1이면 건다)
  local input; input=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":sys.argv[2],"tool_input":{"command":sys.argv[3]},"session_id":sys.argv[1]}))' "$2" "$3" "$4")
  if [ "$5" = 1 ]; then printf '%s' "$input" | SPEC_OWNER_REQUEST=7 SPEC_OWNER_SCAN="$T/src" "$HOOK" 2>/dev/null
  else printf '%s' "$input" | env -u SPEC_OWNER_REQUEST "$HOOK" 2>/dev/null; fi
  got=$?
  if [ "$got" != "$1" ]; then echo "실패: 기대 $1 실제 $got — $2 $3 $4 (담당 환경 $5)"; fail=1; fi
}
# 사용법: check 기대 세션 도구 명령 담당환경  (인자 순서를 아래 함수로 맞춘다)
run() { local want=$1 sid=$2 tool=$3 cmd=$4 env=$5; check "$want" "$sid" "$tool" "$cmd" "$env"; }
run 0 COPY-1 EnterWorktree '' 0
run 2 COPY-1 EnterWorktree '' 1
run 0 ORIG-1 EnterWorktree '' 1
run 2 COPY-1 Bash 'git checkout -b newbranch' 1
run 2 COPY-1 Bash 'git worktree add ../x' 1
run 2 COPY-1 Bash 'git commit -m x' 1
run 2 COPY-1 Bash "node $ROOT/skills/spec-view/spec.mjs request design --id 7" 1
run 0 COPY-1 Bash 'git status' 1
run 0 COPY-1 Bash 'ls' 1
run 0 ORIG-1 Bash 'git commit -m x' 1
run 0 COPY-1 Bash 'git checkout -b newbranch' 0
rm -rf "$T"
[ $fail = 0 ] && echo "통과"
exit $fail
