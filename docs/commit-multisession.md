# 여러 세션이 한 폴더를 쓸 때의 커밋

- 자기가 고친 파일만 이름을 지정해 add 한다 (`git add -A`, `git add .`은 다른 세션 변경까지 섞는다)
- 커밋도 파일을 지정한다: `git commit -m "…" -- 파일1 파일2`. `git add` 뒤 그냥 `git commit`을 하면 다른 세션이 스테이징에 올려 둔 파일까지 딸려 들어간다
- `.git/index.lock` 때문에 실패하면 다른 세션이 커밋 중이다. 잠금 파일을 지우지 말고 몇 초 기다렸다 다시 한다
- 시작 전에 다른 세션의 작업을 본다: `git status --short; git log --oneline -5`
