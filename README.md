# dev-method

모든 프로젝트에 쓰는 개발 방법. 계속 검증하며 고친다.

- `CORE.md` — 늘 읽히는 핵심. `~/.claude/CLAUDE.md`에서 `@/Volumes/macex/workspace/dev-method/CORE.md`로 불러온다 (이 경로의 볼륨이 붙어 있어야 읽힌다)
- `docs/` — 필요한 순간에만 읽는 세부. CORE.md의 상황형 포인터가 가리킨다 (`method-authoring.md`: 정책을 어디에 둘지, `source-comments.md`, `commit-message.md`)
- `src/` — spec-view 도구의 소스(TypeScript). `skills/spec-view/spec.mjs`가 입구이고 `npm install` 한 번이 필요하다. 타입 검사는 `npm run typecheck`, 이 프로젝트 자신도 spec-view로 관리한다(`.spec/`)
- `sample/` — spec-view를 시험하는 작은 예시 앱
- `skills/` — 훅 설치본·참고 구현이 딸린 것만
  - `git-multisession` — 위험한 git 명령을 막는 Claude 훅 설치(시험 포함)
  - `monitor-screen` — 진행 상황을 화면으로 보여주는 원칙과 참고 구현
  - `secret-guard` — 비밀번호·키 커밋을 막는 git 훅
  - `spec-view` — 소스 주석 태그와 TypeScript 분석으로 사용 흐름·정보 흐름·화면 설계서·요청 관리를 보여주는 도구의 안내(`SKILL.md`, `rules/`)와 입구(`spec.mjs`). 도구 소스는 맨 위 `src/`에 있다
- `install.sh` — `links`(스킬을 `~/.claude/skills`에 링크), `hooks <프로젝트>`(훅 설치), `spec <프로젝트> [소스폴더]`(spec-view 경고 0 커밋 검사 연결), `check`·`sync`(설치본이 원본과 같은지 보기·맞추기)
- `installed-projects.txt` — 훅을 설치한 프로젝트 목록 (`check`·`sync`가 읽는다)

## 새 기기에서 시작하기

준비물: git, Node 20 이상, Claude Code. 화면 확인에는 ego-browser가 필요하다(`SETTINGS.md`의 "화면 확인 브라우저").

1. 클론하고 도구 의존성을 설치한다.
   ```
   git clone https://github.com/hiyong7759/dev-method.git
   cd dev-method && npm install
   ```
2. 스킬을 `~/.claude/skills`에 링크한다: `./install.sh links`
3. `SETTINGS.md`의 오른쪽 값(역할·언어·시간대·브라우저)을 내 것으로 고친다.
4. `~/.claude/CLAUDE.md`에 아래 한 줄을 적어 `CORE.md`를 불러온다. 경로는 클론한 위치로 바꾼다.
   ```
   @/내가/클론한/경로/dev-method/CORE.md
   ```
   `CORE.md` 안의 `@.../SETTINGS.md`, `docs/` 경로(맨 앞 `/Volumes/macex/workspace/dev-method`)도 같은 위치로 바꾼다. 안 바꾸면 규칙이 읽히지 않는다.
5. (선택) 브라우저 직접 실행을 막고 ego-browser만 쓰게 한다: `./install.sh browser ~/.claude/settings.json`

## 프로젝트에 적용하기

| 하고 싶은 것 | 명령 |
|---|---|
| 위험한 git 명령 차단·비밀값 커밋 차단 훅 | `./install.sh hooks <프로젝트>` 후 안내대로 `.claude/settings.json`에 훅 등록 (`skills/git-multisession` 참고) |
| spec-view(설계서·요청 관리) 연결 | `./install.sh spec <프로젝트> [소스폴더]` |
| 설치본이 원본과 같은지 확인·맞추기 | `./install.sh check` / `./install.sh sync` |

`installed-projects.txt`·`spec-projects.txt`는 이 저장소 주인의 프로젝트 목록이다. 새로 쓰는 사람은 비우고 시작한다. 시험만 해 볼 때는 명령 끝에 `--no-register`를 붙이면 목록을 건드리지 않는다.
