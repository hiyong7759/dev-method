#!/bin/bash
# 이 저장소의 스킬 링크와 훅 설치본을 한 곳에서 관리한다.
# 훅은 프로젝트에 복사해 쓰므로 원본을 고치면 설치본이 낡는다. 설치한 프로젝트를 installed-projects.txt에 적어 두고 check/sync로 맞춘다.
#   ./install.sh links            ~/.claude/skills에 스킬 심볼릭 링크 만들기 (새 기기)
#   ./install.sh hooks <프로젝트>  훅 복사, git pre-commit 연결, 설치 목록에 추가
#   ./install.sh spec <프로젝트> [소스폴더]  spec-view 경고 0 커밋 검사 연결(.spec/config.json, git pre-commit)
#   ./install.sh check            설치 목록의 프로젝트가 원본과 같은지 보기 (바꾸지 않음)
#   ./install.sh sync             설치본을 원본으로 덮어쓰기 (프로젝트 저장소에 변경으로 남으니 커밋은 따로)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
LIST="$ROOT/installed-projects.txt"
# 원본 훅: 이름=원본 경로
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
  touch "$LIST"; grep -qxF "$P" "$LIST" || echo "$P" >> "$LIST"
  echo "설치: $P"
  echo "남은 일: $P/.claude/settings.json에 PreToolUse(Bash) 훅 등록 (git-multisession 스킬 참고)"
  ;;
spec)
  P=$(cd "$2" && pwd) || exit 1
  mkdir -p "$P/.spec"
  [ -f "$P/.spec/config.json" ] || printf '{ "src": "%s" }\n' "${3:-src}" > "$P/.spec/config.json"
  HOOK="$P/.git/hooks/pre-commit"
  LINE='node '"$ROOT"'/skills/spec-view/precommit.mjs "$(git rev-parse --show-toplevel)" || exit 1'
  if [ ! -f "$HOOK" ]; then printf '#!/bin/bash\n%s\n' "$LINE" > "$HOOK"; chmod +x "$HOOK"
  elif ! grep -qF precommit.mjs "$HOOK"; then echo "$LINE" >> "$HOOK"; fi
  echo "연결: $P (소스 폴더 $(sed -n 's/.*"src": "\(.*\)".*/\1/p' "$P/.spec/config.json"))"
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
