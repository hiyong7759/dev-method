# dev-method

모든 프로젝트에 쓰는 개발 방법. 계속 검증하며 고친다.

- `CORE.md` — 늘 읽히는 핵심. `~/.claude/CLAUDE.md`에서 `@/Volumes/macex/workspace/dev-method/CORE.md`로 불러온다 (이 경로의 볼륨이 붙어 있어야 읽힌다)
- `docs/` — 필요한 순간에만 읽는 세부. CORE.md의 상황형 포인터가 가리킨다 (`method-authoring.md`: 정책을 어디에 둘지, `delegate.md`, `long-running.md`, `new-session.md`, `memory-cleanup.md`)
- `skills/` — 훅 설치본·참고 구현이 딸린 것만
  - `design-as-source` — 소스를 쓰거나 고칠 때 주석·커밋
  - `git-multisession` — 여러 세션이 한 폴더를 쓸 때 git, 위험 명령 훅(시험 포함)
  - `monitor-screen` — 진행 상황을 화면으로 보여주는 원칙과 참고 구현
  - `secret-guard` — 비밀번호·키 커밋을 막는 git 훅
- `install.sh` — `links`(스킬을 `~/.claude/skills`에 링크), `hooks <프로젝트>`(훅 설치), `check`·`sync`(설치본이 원본과 같은지 보기·맞추기)
- `installed-projects.txt` — 훅을 설치한 프로젝트 목록 (`check`·`sync`가 읽는다)

바꿀 때는 사용자 확인을 받고, 이유를 커밋에 남긴다.
