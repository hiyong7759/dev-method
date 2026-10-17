# dev-method

모든 프로젝트에 쓰는 개발 방법. 계속 검증하며 고친다.

- `CORE.md` — 늘 읽히는 핵심. `~/.claude/CLAUDE.md`에서 `@/Volumes/macex/workspace/dev-method/CORE.md`로 불러온다 (이 경로의 볼륨이 붙어 있어야 읽힌다)
- `skills/` — 필요한 작업에서만 읽히는 세부
  - `method-authoring` — 정책을 어디에 어떤 장치로 둘지 (CORE는 핵심만)
  - `delegate-research` — 다른 에이전트에게 맡기는 기준
  - `long-running-work` — 오래 걸리는 일을 띄우는 순서
  - `memory-cleanup` — 작업 묶음이 끝났을 때 메모리 정리
  - `new-session-prompt` — 새 세션 시작 문구에 적을 것
  - `design-as-source` — 소스를 쓰거나 고칠 때 주석·커밋
  - `git-multisession` — 여러 세션이 한 폴더를 쓸 때 git, 위험 명령 훅(시험 포함)
  - `monitor-screen` — 진행 상황을 화면으로 보여주는 원칙과 참고 구현
  - `secret-guard` — 비밀번호·키 커밋을 막는 git 훅
- `install.sh` — `links`(스킬을 `~/.claude/skills`에 링크), `hooks <프로젝트>`(훅 설치), `check`·`sync`(설치본이 원본과 같은지 보기·맞추기)
- `installed-projects.txt` — 훅을 설치한 프로젝트 목록 (`check`·`sync`가 읽는다)

바꿀 때는 사용자 확인을 받고, 이유를 커밋에 남긴다.
