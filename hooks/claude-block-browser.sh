#!/bin/bash
# Claude Code PreToolUse 훅: 화면을 볼 때 크롬·사파리 같은 브라우저를 직접 띄우지 못하게 막고 ego-browser(스킬 /ego-browser)를 쓰게 한다
# 입력: 표준입력의 훅 JSON(tool_name, tool_input.command). 막으면 종료 코드 2 + 이유를 표준에러로(에이전트에게 보인다)
# 방식: 명령 앞부분(실행하는 프로그램)만 본다. 따옴표 안의 글(커밋 메시지, 설명)은 명령이 아니라 보지 않는다.
#       ego-browser로 실행하는 명령은 통과. 크롬용 MCP 도구(이름에 chrome이 든 mcp__…)도 막는다. 시험: test-claude-block-browser.sh
PY=$(cat <<'PY'
import json, re, sys

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
tool = d.get("tool_name", "") or ""
cmd = (d.get("tool_input") or {}).get("command", "") or ""

WHY = "브라우저는 직접 띄우지 않고 ego-browser(스킬 /ego-browser)로 엽니다. 먼저 `ego-browser skill`로 사용법을 읽고, `ego-browser nodejs`로 화면을 열어 확인하세요."

def block(what):
    sys.stderr.write(f"차단: {what} — {WHY}\n")
    sys.exit(2)

if re.search(r"chrome", tool, re.I) and tool.startswith("mcp__"):
    block(f"크롬 도구 {tool}")
if not cmd:
    sys.exit(0)

def segments(s):
    """따옴표 밖에서 ; & | 줄바꿈으로 나눈 명령 조각의 토큰 목록(heredoc 본문과 따옴표 안 글은 보지 않는다)."""
    out, toks, cur, has, q = [], [], [], False, None
    pending, i, n = None, 0, len(s)
    def end_tok():
        nonlocal cur, has
        if has: toks.append("".join(cur))
        cur, has = [], False
    def end_seg():
        nonlocal toks
        end_tok()
        if toks: out.append(toks)
        toks = []
    while i < n:
        c = s[i]
        if q:
            if c == q: q = None
            elif c == "\\" and q == '"' and i + 1 < n: i += 1; cur.append(s[i])
            else: cur.append(c)
        elif c in "\"'": q = c; has = True
        elif c == "\\" and i + 1 < n: i += 1; cur.append(s[i]); has = True
        elif c in " \t": end_tok()
        elif c in ";&|\n":
            hd = pending if c == "\n" else None
            end_seg()
            if hd:
                m = re.search(r"^" + re.escape(hd) + r"[ \t]*$", s[i + 1:], re.M)
                i = (i + 1 + m.end()) if m else n
                pending = None
                continue
        elif s.startswith("<<", i) and not s.startswith("<<<", i):
            m = re.match(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", s[i:])
            if m: pending = m.group(2); i += m.end(); continue
            cur.append(c); has = True
        else: cur.append(c); has = True
        i += 1
    end_seg()
    return out

BROWSERS = re.compile(r"(google[ -]?chrome|chromium|chrome-headless-shell|chrome-cli|msedge|microsoft[ -]edge|firefox|safari|brave|^arc$|puppeteer|playwright|selenium|chromedriver)", re.I)
PRE = ("sudo", "command", "exec", "env", "time", "nohup")

def check(toks):
    k = 0
    while k < len(toks) and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[k]) or toks[k] in PRE):
        k += 1
    if k >= len(toks): return
    prog = toks[k].split("/")[-1]
    args = toks[k + 1:]
    if prog == "ego-browser": return
    # 브라우저 프로그램을 직접 실행(경로 끝이 Google Chrome 등)
    if BROWSERS.search(toks[k]) or BROWSERS.search(prog):
        block(f"{prog} 실행")
    if prog in ("npx", "npm", "pnpm", "yarn", "bunx") and any(BROWSERS.search(a) for a in args):
        block(f"{prog} {' '.join(args[:3])}")
    if prog in ("open", "xdg-open", "start", "gnome-open"):
        # open -a <앱> 으로 브라우저를 열거나, 주소(http…)를 기본 브라우저로 여는 것
        joined = " ".join(args)
        if BROWSERS.search(joined) or re.search(r"https?://", joined) or re.search(r"\.html?\b", joined):
            block(f"{prog} {joined[:60]}")
    # 파이썬·노드 한 줄 스크립트가 브라우저를 직접 부르는 것(-c, -e 로 넘긴 글 안의 브라우저 이름)
    if prog.startswith(("python", "node")) and any(BROWSERS.search(a) for a in args) and any(a in ("-c", "-e", "--eval") for a in args):
        block(f"{prog} 한 줄 스크립트로 브라우저 실행")

for toks in segments(cmd):
    check(toks)
sys.exit(0)
PY
)
exec python3 -c "$PY"
