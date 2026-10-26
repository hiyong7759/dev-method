#!/bin/bash
# Claude Code PreToolUse 훅(담당 세션용): 명령 글에 비밀 파일 이름(.spec/local.json, .env*)이 들어 있으면 막는다
# 이유: claude의 읽기 금지 목록은 Read 도구만 막아서, 명령(cat·node -e 등)으로 읽는 길이 남는다. 이 훅이 그 길을 한 번 더 막는다.
# 입력: 표준입력의 훅 JSON(tool_name, tool_input.command, cwd). 막으면 종료 코드 2 + 이유를 표준에러로(에이전트에게 보인다)
# 한계: 이름을 쪼개 쓰는 등의 우회까지는 못 막는다. 막은 시도는 <프로젝트>/.spec/blocked-reads.log에 남긴다. 시험: test-claude-block-secret-read.sh
PY=$(cat <<'PY'
import json, os, re, sys, time

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command", "") or ""
# .env는 앞에 경계 글자(공백·/·따옴표·=)가 있을 때만(process.env 같은 코드 글은 통과), local.json은 어디서든
hit = re.search(r"local\.json", cmd) or re.search(r"(^|[\s/'\"=])\.env(\.[A-Za-z0-9_-]+)?($|[\s/'\"])", cmd)
if not hit:
    sys.exit(0)
cwd = d.get("cwd") or os.getcwd()
try:
    spec = os.path.join(cwd, ".spec")
    if os.path.isdir(spec):
        with open(os.path.join(spec, "blocked-reads.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + cmd[:300].replace("\n", " ") + "\n")
except Exception:
    pass
sys.stderr.write("차단: 비밀 값이 든 파일(.spec/local.json, .env*)은 담당 세션이 읽지 않습니다. 값이 필요하면 `request ask`로 사용자에게 물으세요.\n")
sys.exit(2)
PY
)
exec python3 -c "$PY"
