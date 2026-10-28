#!/bin/bash
# Claude Code PreToolUse 훅(담당 세션용): 이 세션이 요청 담당의 "원본"이 아니면(복사본) 워크트리 만들기·브랜치 만들기·커밋·요청 상태 변경을 막는다
# 이유: 담당이 복사돼 둘이 되면 같은 요청의 브랜치·워크트리가 겹쳐 생긴다. 판단은 도구(request guard → owner-check)가 하고 이 훅은 배달만 한다.
# 입력: 표준입력의 훅 JSON(tool_name, tool_input.command, session_id). 담당 세션만 환경 SPEC_OWNER_REQUEST를 받으므로, 없으면(메인 에이전트 등) 바로 통과한다.
# 막으면 종료 코드 2 + 이유를 표준에러로(에이전트에게 보인다). 시험: test-claude-block-nonowner.sh
[ -z "$SPEC_OWNER_REQUEST" ] && exit 0
IN=$(cat)
# 관계없는 명령은 node를 띄우지 않고 바로 통과(훅이 모든 Bash 호출에 붙으므로)
case "$IN" in
  *EnterWorktree*|*git*|*spec.mjs*) ;;
  *) exit 0 ;;
esac
SPEC="$(cd "$(dirname "$0")/.." && pwd)/skills/spec-view/spec.mjs"
printf '%s' "$IN" | node "$SPEC" request guard --src "${SPEC_OWNER_SCAN:-src}"
exit $?
