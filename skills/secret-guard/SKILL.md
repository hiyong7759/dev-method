---
name: secret-guard
description: 비밀번호·API 키·토큰이 저장소에 커밋되는 것을 막는 git 훅과 설치법. 새 프로젝트에 이 보호 장치를 설치할 때, 또는 이 훅에 커밋이 막혔을 때 읽는다
---

# 비밀번호·키 커밋 막기

`hooks/pre-commit-secrets.sh`는 커밋 직전에 이번 커밋의 추가 줄을 보고, 비밀번호·키로 보이면 커밋을 막는다.
- 막는 것: `.env` 파일(`.env.example` 등 예시는 허용), 키 이름에 8자 이상 값 대입, 개인 키 파일 내용, AWS·Anthropic·OpenAI·GitHub·Slack 키 형식, 긴 Bearer 토큰
- 사용자가 직접 하는 커밋도 막도록 Claude 훅이 아니라 git 훅으로 둔다

## 설치 (새 프로젝트)

저장소 루트에서 `./install.sh hooks <프로젝트 경로>` (훅 복사 + git pre-commit 연결 + 설치 목록 등록). `.git/hooks`는 저장소에 올라가지 않으므로 새로 clone하면 다시 실행해야 하고, `./install.sh check`가 연결이 빠진 곳을 알려 준다.
확인: 시험용 파일에 `API_KEY="abcd1234efgh"`를 넣고 커밋해서 막히는지 본다

## 막혔을 때

- 값을 `.env`로 옮기고 코드는 환경 변수로 읽게 고친다. `.env`는 `.gitignore`에 넣는다
- 오탐(예: 테스트용 가짜 값)이면 걸린 줄을 사용자에게 보여 주고 판단을 받는다. 에이전트가 `--no-verify`로 건너뛰지 않는다 (`git-multisession`의 Claude 훅이 막는다)
