#!/bin/bash
# claude-block-secret-read.sh 시험: 막아야 하는 명령은 종료 코드 2, 통과해야 하는 명령은 0
HOOK="$(cd "$(dirname "$0")" && pwd)/claude-block-secret-read.sh"
fail=0
check() { # 기대 종료코드, 명령
  python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]},"cwd":"/nonexistent"}))' "$2" | "$HOOK" 2>/dev/null
  got=$?
  if [ "$got" != "$1" ]; then echo "실패: 기대 $1 실제 $got — $2"; fail=1; fi
}
check 2 'cat .spec/local.json'
check 2 'node -e "require(fs).readFileSync(.spec/local.json)"'
check 2 'cat .env'
check 2 'grep KEY ./.env.local'
check 2 'cat "$HOME/proj/.env"'
check 0 'npm run typecheck'
check 0 'node /x/spec.mjs request ask --id 1 --text "process.env 를 읽어도 되나요"'
check 0 'git status'
check 0 'echo $ENV_NAME'
[ $fail = 0 ] && echo "통과"
exit $fail
