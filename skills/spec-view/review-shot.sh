#!/bin/bash
# 검토용 캡처(바꾼 부분만 잘라 찍고, 지난번과 나란히 비교). ego-browser로만 브라우저를 연다.
#   사용: review-shot.sh <주소> <이름> '<[["구역","CSS 선택자"],…]>' [저장 폴더]
#   예:   review-shot.sh 'http://localhost:5291/__spec/#/screen/하루%20일정?tab=now' 현행탭 '[["화면",".stage"],["목록",".sidepanel"]]'
# 구역을 생략('[]')하면 화면 전체. 저장 폴더 기본값은 현재 폴더의 .spec/review-shots (커밋하지 않는다).
# 같은 이름으로 다시 찍으면 지난번은 <구역>.prev.png로 남고 <구역>.compare.png(이전|지금)가 만들어진다.
set -e
URL="$1"; NAME="$2"; AREAS="${3:-[]}"; DIR="${4:-$PWD/.spec/review-shots}"
[ -n "$URL" ] && [ -n "$NAME" ] || { sed -n 2,7p "$0"; exit 1; }
[ "$AREAS" = "[]" ] && AREAS='[["전체",""]]'
# 여러 프로젝트를 함께 쓸 때 헷갈리지 않게 저장 이름 앞에 프로젝트 이름을 붙인다(설정 project.name, 없으면 폴더 이름)
PN=$(python3 -c 'import json,os,sys; c=json.load(open(".spec/config.json")) if os.path.exists(".spec/config.json") else {}; print((c.get("project") or {}).get("name") or os.path.basename(os.getcwd()))')
case "$NAME" in "$PN"-*) ;; *) NAME="$PN-$NAME" ;; esac
mkdir -p "$DIR"
grep -qxF 'review-shots/' "$PWD/.spec/.gitignore" 2>/dev/null || { [ -d "$PWD/.spec" ] && echo 'review-shots/' >> "$PWD/.spec/.gitignore"; } || true
CFG=$(python3 -c 'import json,sys; print(json.dumps({"url":sys.argv[1],"name":sys.argv[2],"areas":json.loads(sys.argv[3]),"dir":sys.argv[4]}, ensure_ascii=False))' "$URL" "$NAME" "$AREAS" "$DIR")
{ echo "globalThis.SHOT = $CFG;"; cat "$(dirname "$0")/review-shot.mjs"; } | ego-browser nodejs
