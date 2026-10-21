#!/bin/bash
# claude-block-browser.sh 시험: 막아야 할 것(=2)과 통과시킬 것(=0)을 확인한다
H="$(cd "$(dirname "$0")" && pwd)/claude-block-browser.sh"
fail=0
t() { # 기대 종료코드, 도구 이름, 명령
  out=$(printf '%s' "{\"tool_name\":\"$2\",\"tool_input\":{\"command\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3")}}" | "$H" 2>&1); code=$?
  if [ "$code" != "$1" ]; then echo "실패: 기대 $1, 실제 $code — $2 $3"; fail=1; fi
}
t 2 Bash '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=a.png file:///a.html'
t 2 Bash '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless'
t 2 Bash 'open -a "Google Chrome" http://localhost:5291'
t 2 Bash 'open http://localhost:5291/'
t 2 Bash 'open prev/a.html'
t 2 Bash 'cd x && google-chrome --version'
t 2 Bash 'npx playwright test'
t 2 Bash 'python3 -c "import selenium"'
t 2 Bash 'chromium --headless'
t 2 mcp__claude-in-chrome__navigate ''
t 0 Bash 'ego-browser nodejs <<EOF
await page.goto("http://localhost:5292/")
EOF'
t 0 Bash 'ego-browser skill'
t 0 Bash 'git commit -m "크롬 대신 ego-browser를 쓴다"'
t 0 Bash 'grep -rn chrome src'
t 0 Bash 'echo "open http://x" | cat'
t 0 Bash 'npm run typecheck'
t 0 Bash 'curl -s http://localhost:5291/'
[ $fail = 0 ] && echo "모두 통과"
exit $fail
