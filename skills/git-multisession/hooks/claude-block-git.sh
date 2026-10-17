#!/bin/bash
# Claude Code PreToolUse(Bash) 훅: 여러 세션이 같이 쓰는 저장소를 망가뜨리는 git 명령을 막는다
# 입력: 표준입력의 훅 JSON (tool_input.command). 막으면 종료 코드 2 + 이유를 표준에러로
# 방식: 따옴표 밖 명령만 ; & | 줄바꿈으로 쪼개 git 전역 옵션(-C, -c …)을 건너뛰고 하위 명령·인자를 본다.
#       따옴표 안(커밋 메시지 등)과 heredoc 본문은 명령이 아니므로 보지 않는다. 시험: test-claude-block-git.sh
PY=$(cat <<'PY'
import json, re, sys

try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    cmd = ""
if not cmd:
    sys.exit(0)

def block(why):
    sys.stderr.write(f"차단: {why} — 여러 세션이 같은 작업 폴더를 쓰므로 금지된 git 명령입니다. 파일 이름을 지정해서 쓰세요 (git-multisession 스킬).\n")
    sys.exit(2)

# 검사 우회 표시는 훅 스크립트만 쓴다 (에이전트가 쓰면 커밋 검사를 건너뛰게 됨)
if "DOCKEEPER=1" in cmd:
    block("DOCKEEPER=1 (커밋 검사 우회)")

def segments(s):
    """따옴표 밖에서 ; & | 줄바꿈으로 나눈 명령 조각의 토큰 목록. heredoc 본문은 건너뛴다."""
    out, toks, cur, has = [], [], [], False
    q = None
    pending_heredoc = None
    i, n = 0, len(s)
    def end_tok():
        nonlocal cur, has
        if has:
            toks.append("".join(cur))
        cur, has = [], False
    def end_seg():
        nonlocal toks
        end_tok()
        if toks:
            out.append(toks)
        toks = []
    while i < n:
        c = s[i]
        if q:
            if c == q:
                q = None
            elif c == "\\" and q == '"' and i + 1 < n:
                i += 1; cur.append(s[i])
            else:
                cur.append(c)
        elif c in "\"'":
            q = c; has = True
        elif c == "\\" and i + 1 < n:
            i += 1; cur.append(s[i]); has = True
        elif c in " \t":
            end_tok()
        elif c in ";&|\n":
            hd = None
            if c == "\n":
                hd = pending_heredoc
            end_seg()
            if hd:
                m = re.search(r"^" + re.escape(hd) + r"[ \t]*$", s[i + 1:], re.M)
                i = (i + 1 + m.end()) if m else n
                pending_heredoc = None
                continue
        elif s.startswith("<<", i) and not s.startswith("<<<", i):
            m = re.match(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", s[i:])
            if m:
                pending_heredoc = m.group(2)
                i += m.end(); continue
            cur.append(c); has = True
        else:
            cur.append(c); has = True
        i += 1
    end_seg()
    return out

GLOBAL_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"}

def short_flags(tok, value_letters=""):
    """-am 같은 합친 짧은 옵션의 글자들. 값을 받는 글자(-m 등) 뒤는 값이라 센다 하지 않는다."""
    if not tok.startswith("-") or tok.startswith("--") or len(tok) < 2:
        return ""
    letters = ""
    for ch in tok[1:]:
        letters += ch
        if ch in value_letters:
            break
    return letters

def check(toks):
    # 환경변수 대입·sudo 같은 앞붙이를 건너뛰고 git을 찾는다
    k = 0
    while k < len(toks) and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[k]) or toks[k] in ("sudo", "command", "exec", "env", "time")):
        k += 1
    if k >= len(toks) or toks[k] != "git":
        return
    k += 1
    while k < len(toks) and toks[k].startswith("-"):
        k += 2 if toks[k] in GLOBAL_WITH_VALUE else 1
    if k >= len(toks):
        return
    sub, args = toks[k], toks[k + 1:]
    # `--` 뒤는 경로. 옵션 검사는 그 앞까지만
    opts = args[:args.index("--")] if "--" in args else args
    long = set(a for a in opts if a.startswith("--"))
    paths = args[args.index("--") + 1:] if "--" in args else [a for a in args if not a.startswith("-")]

    if sub == "commit":
        if "--no-verify" in long: block("git commit --no-verify (커밋 검사 우회)")
        if "--amend" in long: block("git commit --amend")
        if "--all" in long: block("git commit --all (다른 세션 변경까지 섞임)")
        for a in opts:
            f = short_flags(a, "mFCctSu")
            if "n" in f: block("git commit -n (커밋 검사 우회)")
            if "a" in f: block("git commit -a (다른 세션 변경까지 섞임, 파일을 지정하세요)")
    elif sub == "push":
        if "--no-verify" in long: block("git push --no-verify (검사 우회)")
        if "--force" in long or "--force-with-lease" in long or any(l.startswith("--force-with-lease=") or l.startswith("--force-if-includes") for l in long):
            block("git push --force")
        if any("f" in short_flags(a) for a in opts): block("git push -f")
        if any(a.startswith("+") for a in args if not a.startswith("-")): block("git push +<ref> (강제 푸시)")
    elif sub == "add":
        if "--all" in long: block("git add --all")
        if any("A" in short_flags(a) for a in opts): block("git add -A")
        if "." in paths: block("git add .")
        if ("--update" in long or any("u" in short_flags(a) for a in opts)) and not paths: block("git add -u (경로 없음)")
    elif sub == "reset":
        if "--hard" in long: block("git reset --hard")
    elif sub == "stash":
        block("git stash")
    elif sub == "clean":
        block("git clean")
    elif sub == "checkout":
        if "." in paths: block("git checkout .")
    elif sub == "restore":
        if "." in paths: block("git restore .")
    elif sub == "rebase":
        block("git rebase")

for toks in segments(cmd):
    check(toks)
sys.exit(0)
PY
)
exec python3 -c "$PY"
