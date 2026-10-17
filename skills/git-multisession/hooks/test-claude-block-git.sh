#!/bin/bash
# claude-block-git.sh 시험: 막아야 할 명령은 종료 코드 2, 써도 되는 명령은 0이어야 한다
# 훅을 고칠 때마다 돌리고, 새 구멍이 나오면 여기에 사례를 먼저 더한다
H="$(cd "$(dirname "$0")" && pwd)/claude-block-git.sh"
fail=0
t() {  # t <기대 종료코드> <명령>
  got=$(python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$2" | "$H" >/dev/null 2>&1; echo $?)
  [ "$got" = "$1" ] || { echo "실패: 기대 $1, 실제 $got : $2"; fail=1; }
}

# 막아야 함
while IFS= read -r c; do [ -n "$c" ] && t 2 "$c"; done <<'LIST'
git add -A
git add --all
git add .
git add -Av
git -C /x add -A
git -c core.x=1 stash
git stash
git stash pop
git commit -am "x"
git commit -anm x
git commit -n -m x
git commit --no-verify -m x
git commit -a -m x
git commit --all -m x
git commit --amend
git push -f
git push --force
git push --force-with-lease
git push origin +main
git push --no-verify
git reset --hard
git reset --hard HEAD~1
git clean -fd
git checkout .
git checkout -f .
git checkout -- .
git restore .
git restore --staged .
git rebase main
git add -u
cd x && git add -A
echo a; git stash
FOO=1 git add .
DOCKEEPER=1 git commit -m x
LIST

# 써도 됨
while IFS= read -r c; do [ -n "$c" ] && t 0 "$c"; done <<'LIST'
git add src/a.py
git add ./foo
git add src/.env
git add -u src
git commit -m "x" -- a.py
git commit -m "docs: git stash 설명, git add -A 금지"
git commit -mnote -- a.py
git commit -m x -- a.py b.py
git status --short
git log --oneline -5
git diff
git push origin main
git push -u origin main
git checkout -- file
git checkout main
git branch -D x
git restore a.py
echo "git stash"
ls | grep git
LIST

# 여러 줄 명령(heredoc 본문의 단어는 명령이 아니다)
t 0 "git commit -F - -- a.py <<'MSG'
git stash 와 git add -A 설명
MSG"
t 0 "git commit -m \"\$(cat <<'EOF'
메시지 git stash
EOF
)\" -- a.py"
t 2 "git commit -F - -- a.py <<'MSG'
본문
MSG
git add -A"

[ $fail = 0 ] && echo "모두 통과"
exit $fail
