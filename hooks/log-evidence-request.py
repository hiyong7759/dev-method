#!/usr/bin/env python3
# UserPromptSubmit 훅: 사용자가 "근거?"로 시작하는 메시지를 보내면, 근거 없이 말한 답으로 보고 기록한다
# 목적: "사실 확인 먼저" 원칙(CORE.md)이 원칙만으로 지켜지는지 1주일 동안 횟수와 사례로 보기 위함 (사용자 결정, 2026-10-17 시작)
# 에이전트가 기록을 빠뜨리지 않도록 프로그램이 남긴다. 표준출력은 에이전트에게 전달되므로 아무것도 출력하지 않는다
import json, re, sys, datetime, pathlib

LOG = pathlib.Path(__file__).resolve().parent.parent / "checks" / "evidence-requests.md"

try:
    d = json.load(sys.stdin)
    prompt = d.get("prompt", "").strip()
    # "근거?", "근거는?", "근거 있어?"처럼 "근거"로 시작해 짧게 묻는 말 (6자: 조사·짧은 말만 허용하려는 값, 근거 없음)
    if not re.match(r"^근거[^\n?]{0,6}\?", prompt):
        sys.exit(0)
    last = ""
    for line in open(d.get("transcript_path", ""), encoding="utf-8"):
        try:
            m = json.loads(line)
        except Exception:
            continue
        c = m.get("message", {}).get("content")
        if m.get("type") == "assistant" and isinstance(c, list):
            t = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text").strip()
            if t:
                last = t
    excerpt = re.sub(r"\s+", " ", last)[:300]
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    project = pathlib.Path(d.get("cwd", "")).name
    LOG.parent.mkdir(exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"- {now} | {project} | 사용자: {prompt[:100]} | 직전 답: {excerpt}\n")
except Exception:
    pass
sys.exit(0)
