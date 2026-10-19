# dev-method

모든 프로젝트에 쓰는 개발 방법. 계속 검증하며 고친다.

- `CORE.md` — 늘 읽히는 핵심. `~/.claude/CLAUDE.md`에서 `@/Volumes/macex/workspace/dev-method/CORE.md`로 불러온다 (이 경로의 볼륨이 붙어 있어야 읽힌다)
- `docs/` — 필요한 순간에만 읽는 세부. CORE.md의 상황형 포인터가 가리킨다 (`method-authoring.md`: 정책을 어디에 둘지, `source-comments.md`, `commit-message.md`, `commit-multisession.md`, `delegate.md`, `long-running.md`, `memory-cleanup.md`)
- `src/` — spec-view 도구의 소스(TypeScript). `skills/spec-view/spec.mjs`가 입구이고 `npm install` 한 번이 필요하다. 타입 검사는 `npm run typecheck`, 이 프로젝트 자신도 spec-view로 관리한다(`.spec/`)
- `sample/` — spec-view를 시험하는 작은 예시 앱
- `skills/` — 훅 설치본·참고 구현이 딸린 것만
  - `git-multisession` — 위험한 git 명령을 막는 Claude 훅 설치(시험 포함)
  - `monitor-screen` — 진행 상황을 화면으로 보여주는 원칙과 참고 구현
  - `secret-guard` — 비밀번호·키 커밋을 막는 git 훅
  - `spec-view` — 소스 주석 태그와 TypeScript 분석으로 화면 흐름·정보 흐름·화면 설계서·요청 관리를 보여주는 도구의 안내(`SKILL.md`, `rules/`)와 입구(`spec.mjs`). 도구 소스는 맨 위 `src/`에 있다
- `install.sh` — `links`(스킬을 `~/.claude/skills`에 링크), `hooks <프로젝트>`(훅 설치), `spec <프로젝트> [소스폴더]`(spec-view 경고 0 커밋 검사 연결), `check`·`sync`(설치본이 원본과 같은지 보기·맞추기)
- `installed-projects.txt` — 훅을 설치한 프로젝트 목록 (`check`·`sync`가 읽는다)

바꿀 때는 사용자 확인을 받고, 이유를 커밋에 남긴다.
