#!/bin/bash
# git pre-commit 훅: 비밀번호·키가 저장소에 들어가는 것을 커밋 직전에 막는다
# 에이전트 커밋과 사용자 커밋을 모두 막으려고 Claude 훅이 아니라 git 훅으로 둔다
# 검사 대상: 이번 커밋에 들어가는 추가 줄(git diff --cached). `git commit -- 파일` 도 git이 임시 스테이징을 만들어 같은 방식으로 보인다
# 막으면 종료 코드 1 + 걸린 줄을 표준에러로

DIFF=$(git diff --cached --no-color -U0 --diff-filter=ACMR)
[ -z "$DIFF" ] && exit 0
FOUND=""

# .env 파일 자체 (예시 파일은 허용)
ENV_FILES=$(git diff --cached --name-only --diff-filter=ACR | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template)$')
[ -n "$ENV_FILES" ] && FOUND+="[.env 파일]\n$ENV_FILES\n"

# 추가된 줄만 (+++ 머리줄 제외)
ADDED=$(printf '%s\n' "$DIFF" | grep -E '^\+' | grep -vE '^\+\+\+ ')
check() {
  local hits
  hits=$(printf '%s\n' "$ADDED" | grep -E $3 -- "$2" | head -5)
  [ -n "$hits" ] && FOUND+="[$1]\n$hits\n"
}
# 이름에 key·secret·token·password가 들어간 변수에 8자 이상 문자열을 넣는 줄 (8자: 빈 값·짧은 자리표시를 거르려는 값, 근거 없음)
check "키 이름에 값 대입" '(api[_-]?key|secret|token|passw(or)?d|private[_-]?key)[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}' -i
check "개인 키 파일 내용" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
check "AWS 접근 키" 'AKIA[0-9A-Z]{16}'
check "Anthropic·OpenAI 키" 'sk-(ant-)?[A-Za-z0-9_-]{20,}'
check "GitHub 토큰" 'gh[pousr]_[A-Za-z0-9]{30,}'
check "Slack 토큰" 'xox[baprs]-[A-Za-z0-9-]{10,}'
check "Bearer 토큰" 'Bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}'

[ -z "$FOUND" ] && exit 0
{
  echo "커밋 차단: 비밀번호·키로 보이는 내용이 있습니다."
  printf '%b' "$FOUND"
  echo "고치는 법: 값은 .env(저장소 밖)에 두고 코드는 환경 변수로 읽는다. 오탐이면 사용자에게 보여 주고 판단을 받는다."
} >&2
exit 1
