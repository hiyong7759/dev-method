#!/bin/bash
# 이 저장소의 스킬 링크와 훅 설치본을 한 곳에서 관리한다.
# 훅은 프로젝트에 복사해 쓰므로 원본을 고치면 설치본이 낡는다. 설치한 프로젝트를 installed-projects.txt에 적어 두고 check/sync로 맞춘다.
#   ./install.sh links            ~/.claude/skills에 스킬 심볼릭 링크 만들기 (새 기기)
#   ./install.sh hooks <프로젝트>  훅 복사, git pre-commit 연결, 설치 목록에 추가
#   ./install.sh spec <프로젝트> [소스폴더] [앱주소] [포트] [--no-register]  spec-view 설정(.spec/config.json), 프로젝트 이름 등록(spec-projects.txt), 경고 0 커밋 검사(git pre-commit) 연결. 추적 중인 .env 파일이 있으면 비밀 값 차단 훅도 함께 연결. --no-register는 이 저장소의 spec-projects.txt·installed-projects.txt를 건드리지 않는다(시험 복제본용)
#   ./install.sh browser <settings.json 경로>  크롬 등 브라우저 직접 실행을 막고 ego-browser를 쓰게 하는 Claude 훅 등록 (전역은 ~/.claude/settings.json)
#   ./install.sh agent-hook <settings.json 경로>  담당 세션에 사용자 결정(설계 승인·반려 등)을 알려 주는 Claude 훅 등록
#   ./install.sh check            설치 목록의 프로젝트가 원본과 같은지 보기 (바꾸지 않음)
#   ./install.sh sync             설치본을 원본으로 덮어쓰기 (프로젝트 저장소에 변경으로 남으니 커밋은 따로)
set -e
# --no-register: 이 저장소의 등록 목록 파일을 고치지 않는다(다른 곳에서 시험할 때)
NOREG=""; ARGS=(); for a in "$@"; do if [ "$a" = "--no-register" ]; then NOREG=1; else ARGS+=("$a"); fi; done; set -- "${ARGS[@]}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
LIST="$ROOT/installed-projects.txt"
# 원본 훅: 이름=원본 경로
BROWSER="$ROOT/hooks/claude-block-browser.sh"
BLOCK="$ROOT/skills/git-multisession/hooks/claude-block-git.sh"
SECRETS="$ROOT/skills/secret-guard/hooks/pre-commit-secrets.sh"

case "$1" in
links)
  mkdir -p ~/.claude/skills
  for d in "$ROOT"/skills/*/; do
    n=$(basename "$d")
    ln -sfn "${d%/}" ~/.claude/skills/"$n" && echo "링크: $n"
  done
  ;;
hooks)
  P=$(cd "$2" && pwd) || exit 1
  mkdir -p "$P/tools/hooks"
  cp "$BLOCK" "$SECRETS" "$P/tools/hooks/"
  chmod +x "$P/tools/hooks/"*.sh
  HOOK="$P/.git/hooks/pre-commit"
  LINE='"$(git rev-parse --show-toplevel)"/tools/hooks/pre-commit-secrets.sh || exit 1'
  if [ ! -f "$HOOK" ]; then printf '#!/bin/bash\n%s\n' "$LINE" > "$HOOK"; chmod +x "$HOOK"
  elif ! grep -qF pre-commit-secrets.sh "$HOOK"; then echo "$LINE" >> "$HOOK"; fi
  [ -n "$NOREG" ] || { touch "$LIST"; grep -qxF "$P" "$LIST" || echo "$P" >> "$LIST"; }
  echo "설치: $P"
  echo "남은 일: $P/.claude/settings.json에 PreToolUse(Bash) 훅 등록 (git-multisession 스킬 참고)"
  ;;
spec)
  P=$(cd "$2" && pwd) || exit 1
  mkdir -p "$P/.spec"
  [ -f "$P/.spec/config.json" ] || printf '{ "src": "%s", "app": "%s", "port": %s, "start": "npm run dev" }\n' "${3:-src}" "${4:-http://localhost:5173}" "${5:-5290}" > "$P/.spec/config.json"
  HOOK="$P/.git/hooks/pre-commit"
  LINE='node '"$ROOT"'/skills/spec-view/spec.mjs precommit "$(git rev-parse --show-toplevel)" || exit 1'
  if [ ! -f "$HOOK" ]; then printf '#!/bin/bash\n%s\n' "$LINE" > "$HOOK"; chmod +x "$HOOK"
  elif grep -qF 'spec.mjs precommit' "$HOOK"; then :
  elif grep -qF 'spec-view/precommit.mjs' "$HOOK"; then grep -vF 'spec-view/precommit.mjs' "$HOOK" > "$HOOK.new" && echo "$LINE" >> "$HOOK.new" && mv "$HOOK.new" "$HOOK" && chmod +x "$HOOK"
  else echo "$LINE" >> "$HOOK"; fi
  # 커밋 메시지에 요청 번호가 없으면 막는다(요청이 하나라도 있는 프로젝트만, 병합·되돌리기 제외)
  CM="$P/.git/hooks/commit-msg"
  CMLINE='node '"$ROOT"'/skills/spec-view/spec.mjs commit-msg "$1" "$(git rev-parse --show-toplevel)" || exit 1'
  if [ ! -f "$CM" ]; then printf '#!/bin/bash\n%s\n' "$CMLINE" > "$CM"; chmod +x "$CM"
  elif ! grep -qF 'spec.mjs commit-msg' "$CM"; then echo "$CMLINE" >> "$CM"; fi
  [ -f "$P/.spec/.gitignore" ] || printf 'pids.json\nserve-stamp\nsessions.json\n*.log\nreview-shots/\nlocal.json\ncomments.json\ncomment-shots/\n' > "$P/.spec/.gitignore"
  [ -n "$NOREG" ] || { touch "$ROOT/spec-projects.txt"; grep -qxF "$P" "$ROOT/spec-projects.txt" || echo "$P" >> "$ROOT/spec-projects.txt"; }
  # 이미 git이 추적 중인 .env 파일은 .gitignore에 있어도 `git add -A`에 딸려 올라가므로, 비밀 값 차단 훅을 함께 연결한다
  if (cd "$P" && git ls-files | grep -E '(^|/)\.env($|\.)' | grep -qvE '\.(example|sample|template)$'); then
    echo "추적 중인 .env 파일이 있다 — 비밀 값 차단 훅도 연결한다"; bash "$0" hooks "$P" ${NOREG:+--no-register}
  fi
  echo "연결: $P"; echo "설정: $(tr -d '\n' < "$P/.spec/config.json")"
  ;;
browser)
  # 사용: ./install.sh browser <settings.json 경로>  (이미 등록돼 있으면 그대로 둔다)
  F="$2"; [ -n "$F" ] || { echo "settings.json 경로를 주세요 (전역: ~/.claude/settings.json)"; exit 1; }
  mkdir -p "$(dirname "$F")"; [ -f "$F" ] || echo '{}' > "$F"
  python3 - "$F" "$BROWSER" <<'PY'
import json, sys
f, hook = sys.argv[1], sys.argv[2]
d = json.load(open(f))
pre = d.setdefault("hooks", {}).setdefault("PreToolUse", [])
if any(hook in h.get("command", "") for e in pre for h in e.get("hooks", [])):
    print("이미 등록됨:", f)
else:
    pre.append({"matcher": "Bash|mcp__.*[Cc]hrome.*", "hooks": [{"type": "command", "command": hook}]})
    json.dump(d, open(f, "w"), ensure_ascii=False, indent=2); open(f, "a").write("\n")
    print("등록:", f)
PY
  ;;
agent-hook)
  F="$2"; [ -n "$F" ] || { echo "settings.json 경로를 주세요"; exit 1; }
  mkdir -p "$(dirname "$F")"; [ -f "$F" ] || echo '{}' > "$F"
  python3 - "$F" "node $ROOT/skills/spec-view/spec.mjs inbox" <<'PY'
import json, sys
f, cmd = sys.argv[1], sys.argv[2]
d = json.load(open(f))
hooks = d.setdefault("hooks", {})
changed = False
for event, matcher in (("PostToolUse", "Bash"), ("UserPromptSubmit", None)):
    lst = hooks.setdefault(event, [])
    if any(cmd in h.get("command", "") for e in lst for h in e.get("hooks", [])):
        continue
    entry = {"hooks": [{"type": "command", "command": cmd}]}
    if matcher: entry["matcher"] = matcher
    lst.append(entry); changed = True
json.dump(d, open(f, "w"), ensure_ascii=False, indent=2); open(f, "a").write("\n")
print("등록:" if changed else "이미 등록됨:", f)
PY
  ;;
check|sync)
  [ -f "$LIST" ] || { echo "설치 목록 없음"; exit 0; }
  bad=0
  while IFS= read -r P; do
    [ -n "$P" ] || continue
    for pair in "claude-block-git.sh:$BLOCK" "pre-commit-secrets.sh:$SECRETS"; do
      name=${pair%%:*}; src=${pair#*:}; dst="$P/tools/hooks/$name"
      if [ ! -f "$dst" ]; then echo "없음: $dst"; bad=1; [ "$1" = sync ] && { mkdir -p "$P/tools/hooks"; cp "$src" "$dst"; chmod +x "$dst"; echo "  → 복사"; }
      elif ! cmp -s "$src" "$dst"; then echo "다름: $dst"; bad=1; [ "$1" = sync ] && { cp "$src" "$dst"; echo "  → 덮어씀"; }
      fi
    done
    [ -f "$P/.git/hooks/pre-commit" ] && grep -qF pre-commit-secrets.sh "$P/.git/hooks/pre-commit" || { echo "pre-commit 연결 없음: $P"; bad=1; }
  done < "$LIST"
  [ $bad = 0 ] && echo "모두 같음"
  [ "$1" = check ] && exit $bad || exit 0
  ;;
*)
  sed -n '2,9p' "$0"; exit 1 ;;
esac
