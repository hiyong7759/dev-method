/**
 * @spec data-shapes 도구가 주고받는 데이터의 모양
 * @why 소스 주석을 읽는 쪽(extract), 타입을 분석하는 쪽(analyze-ts), 상태·메모·요청을 저장하는 쪽, 설계서 보기 화면이 같은 데이터를 서로 다르게 이해하지 않도록, 모양을 한곳에서 한 번만 정한다.
 * @contract 이 파일의 모양을 바꾸면 그것을 만드는 파일(extract, analyze-ts, nav, status, memo, request, history, model)과 그려 주는 viewer/ 아래 파일이 함께 맞아야 한다. 타입 검사(npm run typecheck)가 어긋난 곳을 알려 준다.
 */

// ── 소스 주석 태그에서 읽은 것 (extract) ─────────────────────

/** 숨은 요소를 여는 동작의 종류: 누르기, 올리기(마우스 올림), 입력, 엔터 */
export type OpenAct = '누르기' | '올리기' | '입력' | '엔터';

/** 숨은 요소를 여는 한 단계. 소스의 @open이 이 모양으로 읽힌다 */
export interface OpenStep {
  /** 어떤 동작인가 */
  act: OpenAct;
  /** 누를 글자, 또는 입력할 칸의 이름 */
  text?: string;
  /** 입력할 값(입력 동작에서만) */
  value?: string;
}

/** 화면을 눌러 보며 찾은 한 단계. 동작을 안 적으면 누르기로 본다 */
export interface RevealStep {
  /** 어떤 동작인가(없으면 누르기) */
  act?: OpenAct;
  /** 누를 글자, 또는 입력할 칸의 이름 */
  text?: string;
  /** 입력할 값 */
  value?: string;
  /** 눌러 볼 요소의 태그(자동으로 찾은 단계에서만) */
  tag?: string;
  /** 같은 태그와 글자 중 몇 번째인지(자동으로 찾은 단계에서만) */
  nth?: number;
}

/** 화면의 "사용자가 하는 일 | 확인 기준" 한 줄 */
export interface Does {
  /** 사용자가 하는 일 */
  title: string;
  /** 잘 됐는지 보는 기준 */
  check: string;
}

/** 화면 이동 선언 한 줄 */
export interface Move {
  /** 가는 화면의 이름 */
  target: string;
  /** 사용자가 무엇을 해서 가는가 */
  action: string;
  /** 넘기는 값 */
  pass: string;
}

/** 주석의 @screen 하나 */
export interface ScreenTag {
  /** 화면 이름(화면을 가리키는 유일한 이름) */
  name: string;
  /** 이 화면이 왜 있는가 */
  why: string;
  /** 그렇게 정한 근거 */
  basis: string;
  /** 화면의 주소 모양(예: /trips/:tripId) */
  route: string;
  /** 실제 화면을 끼워 보일 예시 주소 */
  sample: string;
  /** 화면 흐름에서 묶어 보이는 분야 이름 */
  domain: string;
  /** 사용자가 처음 들어오는 화면인가 */
  start: boolean;
  /** 사용자가 하는 일 목록(승인 때 확인 목록이 된다) */
  does: Does[];
  /** 이 화면에서 나가는 길 */
  to: Move[];
  /** 주석이 있는 파일(소스 폴더 기준) */
  file: string;
  /** 주석이 있는 줄 */
  line: number;
  /** 이 화면 파일에서 상대 import로 닿는 파일들(소스 폴더 기준). 화면에 속한 요소를 찾는 범위 */
  files: string[];
}

/** 컴포넌트의 이벤트와 그 효과 한 쌍 */
export interface OnEffect {
  /** 어떤 일이 일어났을 때인가 */
  event: string;
  /** 그러면 무슨 일이 생기는가 */
  effect: string;
}

/** 요소의 종류: dom(화면의 요소), 3d(3차원 오브젝트), logic(화면에 안 보이는 로직) */
export type SpecKind = 'dom' | '3d' | 'logic';

/** 주석의 @spec 하나(컴포넌트나 로직) */
export interface Spec {
  /** 요소를 가리키는 유일한 이름 */
  id: string;
  /** 무엇을 맡는지 보이게 쓴 제목 */
  title: string;
  /** 이 요소가 왜 있는가 */
  why: string;
  /** 그렇게 정한 근거 */
  basis: string;
  /** 다른 곳과 한 약속 */
  contract: string;
  /** 이벤트와 효과 목록 */
  ons: OnEffect[];
  /** 화면에서 이 요소를 찾을 표시(dom:선택자 형태). 없으면 화면과 연결되지 않은 로직 */
  anchor: string;
  /** 처음 화면에 안 보일 때 여는 순서 */
  open: OpenStep[];
  /** 요소의 종류 */
  kind: SpecKind;
  /** 주석이 있는 파일(소스 폴더 기준) */
  file: string;
  /** 주석이 있는 줄 */
  line: number;
  /** 이 요소가 속한 화면 이름들 */
  screens: string[];
  /** 처음 화면에 안 보일 때 설계서 보기가 눌러 볼 순서(@open이 있으면 그것, 없으면 검사가 찾아 둔 것) */
  reveal?: RevealStep[];
}

/** 소스 폴더의 주석 태그를 모두 읽은 결과 */
export interface Extracted {
  /** 읽은 화면들 */
  screens: ScreenTag[];
  /** 첫 화면(화면이 하나일 때 이름을 안 적어도 되게) */
  screen: ScreenTag | null;
  /** 읽은 요소들 */
  specs: Spec[];
  /** 메타정보가 비었거나 어긋난 곳의 경고들 */
  warnings: string[];
  /** 읽은 시각 */
  generatedAt: string;
}

// ── 화면 상태와 승인 기록 (status) ────────────────────────

/** 기록으로 남는 화면 상태: 개발 중, 테스트 요청, 수정 필요, 승인됨 */
export type RecordedStatus = 'dev' | 'test-requested' | 'needs-fix' | 'approved';

/** 기록 상태에 계산으로 얻는 "승인 후 변경됨"을 더한 것 */
export type StatusName = RecordedStatus | 'approved-changed';

/** 기록을 남긴 쪽: 에이전트 또는 사용자 */
export type Actor = 'agent' | 'user';

/** 상태가 바뀐 한 번의 기록 */
export interface StatusEvent {
  /** 그때 남긴 상태 */
  status: RecordedStatus;
  /** 누가 남겼나 */
  by: Actor;
  /** 언제 */
  at: string;
  /** 그때의 소스 버전(커밋) */
  commit: string;
  /** 함께 남긴 한 줄 메모 */
  note: string;
  /** 그때 저장한 화면 스냅샷 파일 이름 */
  shot: string;
}

/** .spec/status.json에 저장되는 화면 하나의 기록 */
export interface StatusRecord {
  /** 마지막으로 남긴 상태 */
  status: RecordedStatus;
  /** 마지막으로 남긴 쪽 */
  by: Actor;
  /** 마지막으로 남긴 시각 */
  at: string;
  /** 그때의 소스 버전 */
  commit: string;
  /** 그때 저장하지 않은 변경이 있었는가 */
  dirty: boolean;
  /** 그때 화면 파일들의 내용 해시(나중에 달라졌는지 비교) */
  hash: string;
  /** 함께 남긴 한 줄 메모 */
  note: string;
  /** 그때 저장한 화면 스냅샷 파일 이름 */
  shot: string;
  /** 확인 목록의 체크 상태(번호별) */
  checks: Record<string, boolean>;
  /** 지금까지 바뀐 기록 전체 */
  history: StatusEvent[];
}

/** 화면 하나의 지금 상태. 기록이 없으면 개발 중이고 나머지는 빈 값 */
export interface ScreenStatus {
  /** 화면 이름 */
  screen: string;
  /** 지금 상태(승인 뒤 소스가 바뀌었으면 승인 후 변경됨) */
  status: StatusName;
  /** 화면에 쓰는 상태 이름 */
  label: string;
  /** 변경 감지에 쓰는 파일 수 */
  files: number;
  /** 확인 목록의 체크 상태 */
  checks: Record<string, boolean>;
  /** 마지막으로 남긴 쪽(기록이 없으면 빈 값) */
  by: Actor | '';
  /** 마지막으로 남긴 시각 */
  at: string;
  /** 마지막으로 남긴 때의 소스 버전 */
  commit: string;
  /** 함께 남긴 한 줄 메모 */
  note: string;
  /** 그때 저장한 화면 스냅샷 파일 이름 */
  shot: string;
  /** 기록 뒤에 화면 소스가 바뀌었는가 */
  changedSinceRecord: boolean;
  /** 지금까지 바뀐 기록 전체 */
  history: StatusEvent[];
}

// ── 메모 (memo) ─────────────────────────────────────

/** 메모의 진행: 대기, 응답됨, 반영됨, 확인 완료 */
export type MemoState = 'pending' | 'answered' | 'applied' | 'confirmed';

/** 화면 위 사각형(화면 페이지 좌표) */
export interface Rect {
  /** 왼쪽 위 가로 위치 */
  x: number;
  /** 왼쪽 위 세로 위치 */
  y: number;
  /** 너비 */
  w: number;
  /** 높이 */
  h: number;
}

/** 고른 영역에서 가장 가까운 컴포넌트 */
export interface NearestSpec {
  /** 컴포넌트 제목 */
  title: string;
  /** 소스 위치(파일:줄) */
  file?: string;
  /** 컴포넌트 이름표 */
  id?: string;
}

/** 메모가 가리키는 곳: 컴포넌트, 고른 영역, 빈 영역, 화면 전체 */
export interface MemoTarget {
  /** 어떤 곳을 가리키나 */
  type: 'component' | 'region' | 'empty' | 'screen';
  /** 컴포넌트 이름표(컴포넌트를 가리킬 때) */
  spec?: string;
  /** 컴포넌트 제목 */
  title?: string;
  /** 소스 위치(파일:줄) */
  file?: string;
  /** 고른 영역의 자리와 크기 */
  rect?: Rect;
  /** 메모를 남길 때 열려 있던 화면 주소 */
  route?: string;
  /** 영역에서 가장 가까운 컴포넌트 */
  nearest?: NearestSpec;
  /** 빈 영역의 위·아래에 있는 요소 */
  neighbors?: { above?: string; below?: string };
  /** 고른 영역을 찍은 스크린샷 파일 이름 */
  shot?: string;
  /** 설계서 보기 화면 안에서만 쓰는, 아직 올리지 않은 캡처 데이터 */
  shotData?: string;
}

/** .spec/memos.json의 메모 하나 */
export interface Memo {
  /** 메모 번호 */
  id: number;
  /** 어느 화면에 남겼나 */
  screen: string;
  /** 가리키는 곳 */
  target: MemoTarget;
  /** 종류(예: 오류). 없으면 일반 메모 */
  kind: string;
  /** 사용자가 쓴 한 줄 */
  text: string;
  /** 남긴 시각 */
  at: string;
  /** 남긴 쪽(항상 사용자) */
  by: 'user';
  /** 진행 상태 */
  state: MemoState;
  /** 에이전트에게 전달하려 복사한 시각(아직이면 null) */
  copiedAt: string | null;
  /** 남길 때의 소스 버전 */
  commitAtWrite: string;
  /** 에이전트의 답 */
  reply?: { text: string; at: string; commit: string };
  /** 고친 뒤의 반영 기록 */
  applied?: { at: string; commit: string; change: string };
  /** 사용자가 확인 완료로 바꾼 시각 */
  confirmedAt?: string;
}

// ── 변경 요청 (request) ─────────────────────────────────

/** 요청이 거치는 단계(취소 포함) */
export type RequestStage = 'design' | 'impl' | 'test' | 'done' | 'cancelled';

/** 요청의 출처: 사용자가 한 요청, 에이전트가 올린 리포트에서 등록한 요청 */
export type RequestSource = 'user' | 'report';

/** 요청 진행 기록 한 줄 */
export interface RequestEvent {
  /** 언제 */
  at: string;
  /** 누가 */
  by: Actor;
  /** 어떤 일인가(등록, 완료 등) */
  kind: string;
  /** 사람이 읽을 설명 */
  note: string;
}

/** .spec/requests/<번호>.json 하나 */
export interface Request {
  /** 요청 번호(커밋의 요청 줄과 이어 주는 열쇠) */
  id: number;
  /** 무엇을 바꾸는 요청인지 한 줄 */
  title: string;
  /** 사용자가 한 요청인지, 리포트에서 등록한 것인지 */
  source: RequestSource;
  /** 요청 원문과 들어온 길 */
  origin: {
    /** 사용자가 한 말 그대로 */
    text: string;
    /** 어디로 들어왔나(대화 등) */
    channel: string;
    /** 들어온 시각 */
    at: string;
  };
  /** 건드리는 범위(겹침을 찾는 근거) */
  scope: {
    /** 건드리는 화면 이름들 */
    screens: string[];
    /** 건드리는 정보 이름들 */
    infos: string[];
  };
  /** 이 요청을 맡은 에이전트 */
  agent: {
    /** 맡은 세션의 이름(아직 없으면 빈 값) */
    name: string;
  };
  /** 지금 단계 */
  stage: RequestStage;
  /** 단계 안의 상태(작성 중, 승인 대기 등) */
  step: string;
  /** 진행 기록 */
  events: RequestEvent[];
}

/** 다른 요청과 겹치는 곳 */
export interface RequestOverlap {
  /** 겹치는 요청의 번호 */
  id: number;
  /** 겹치는 요청의 제목 */
  title: string;
  /** 겹치는 화면 */
  screens: string[];
  /** 겹치는 정보 */
  infos: string[];
}

/** 화면에 보여 줄 요청: 이름표, 누구 차례인지, 겹치는 요청을 붙인 것 */
export interface RequestView extends Request {
  /** 단계의 화면용 이름 */
  stageLabel: string;
  /** 상태의 화면용 이름 */
  stepLabel: string;
  /** 지금 누가 움직일 차례인가(끝난 요청은 없음) */
  turn: Actor | null;
  /** 겹치는 요청들 */
  overlaps: RequestOverlap[];
}

// ── 정보 분석 (analyze-ts) ───────────────────────────────

/** 필드가 쓰이는 모습: 읽고 쓰기 둘 다, 읽기만, 쓰기만, 쓰이지 않음 */
export type PropStatus = 'rw' | 'read-only' | 'write-only' | 'none';

/** 참조의 종류: 읽음, 새 객체에 씀, 있던 값을 고침, 그냥 씀, 함수를 거쳐 보여 줌 */
export type RefKind = 'read' | 'create' | 'update' | 'write' | 'via';

/** 화면에서 이 값이 그려지는 요소를 찾을 선택자 힌트 */
export interface DomHint {
  /** 찾을 선택자 */
  sel: string;
  /** el이면 요소 전체, text이면 그 요소 안의 글자 부분만 */
  mode: 'el' | 'text';
}

/** 필드를 쓰는 곳 한 군데 */
export interface PropRef {
  /** 어느 파일 */
  file: string;
  /** 몇째 줄 */
  line: number;
  /** 쓰기인가(아니면 읽기) */
  write: boolean;
  /** 참조의 종류 */
  kind: RefKind;
  /** 화면에 그려지는 곳이면 그 요소를 찾을 힌트 */
  dom: DomHint | null;
  /** 값을 계산해서 보여 주는 함수의 이름(함수를 거친 참조에서만) */
  via?: string;
}

/** 같은 이름의 필드를 손으로 다시 정의한 곳(복제 정의 후보) */
export interface DupDef {
  /** 그 정의가 속한 타입 */
  owner: string;
  /** 어느 파일 */
  file: string;
  /** 몇째 줄 */
  line: number;
  /** 필드의 타입 */
  type: string;
}

/** 소스의 한 지점 */
export interface Place {
  /** 어느 파일 */
  file: string;
  /** 몇째 줄 */
  line: number;
}

/** 필드가 "쓰이지 않는다"고 판단했을 때 그 판단이 틀릴 수 있는 근거 */
export interface PropEvidence {
  /** 같은 이름으로 다시 정의한 곳들(일부만) */
  dups: DupDef[];
  /** 같은 이름으로 다시 정의한 곳의 전체 수 */
  dupTotal: number;
  /** 필드 이름이 문자열로 나오는 곳들(일부만) */
  strs: Place[];
}

/** 분석한 필드 하나 */
export interface AnalyzedProp {
  /** 필드 이름 */
  name: string;
  /** 없어도 되는 필드인가 */
  optional: boolean;
  /** 필드의 타입 글자 */
  type: string;
  /** 정의된 줄 */
  line: number;
  /** 필드의 존재 이유 주석 */
  doc: string;
  /** 영역별로 읽는 횟수 */
  reads: Record<string, number>;
  /** 영역별로 쓰는 횟수 */
  writes: Record<string, number>;
  /** 쓰이는 곳들 */
  refs: PropRef[];
  /** 쓰이는 모습 */
  status: PropStatus;
  /** 쓰이지 않는다는 판단이 틀렸을 수 있는가(같은 이름의 다른 정의나 문자열이 있음) */
  maybe: boolean;
  /** 틀렸을 수 있는 근거 */
  evidence: PropEvidence;
}

/** 분석한 정보 하나(이름 붙은 데이터 정의) */
export interface AnalyzedInfo {
  /** 파일과 이름을 합친 유일한 이름 */
  id: string;
  /** 정보 이름 */
  name: string;
  /** 정의 방식 */
  kind: 'interface' | 'type' | 'enum';
  /** 정의된 파일 */
  file: string;
  /** 정의된 줄 */
  line: number;
  /** 정보의 존재 이유 주석 */
  doc: string;
  /** 영역별로 이 정보가 타입으로 쓰이는 횟수 */
  typeAreas: Record<string, number>;
  /** 정의된 파일 밖에서 타입으로 쓰이는 파일 수 */
  external: number;
  /** 어디에서도 쓰이지 않는가(정리 후보) */
  unused: boolean;
  /** 필드들 */
  props: AnalyzedProp[];
  /** 확인이 필요한 필드 수 */
  flagged: number;
}

/** 타입 분석 결과 전체 */
export interface Analysis {
  /** 프로젝트 폴더 이름 */
  project: string;
  /** 분석한 프로젝트 폴더 */
  root: string;
  /** 분석에 쓴 TypeScript 버전 */
  tsVersion: string;
  /** 읽은 tsconfig 수 */
  programs: number;
  /** 분석에 걸린 시간(밀리초) */
  ms: number;
  /** 분석한 시각 */
  generatedAt: string;
  /** 쓰임을 나눠 센 영역 이름들 */
  areas: string[];
  /** 찾은 정보들 */
  infos: AnalyzedInfo[];
}

// ── 화면 이동 대조 (nav) ───────────────────────────────

/** 코드에서 읽은 화면 이동 한 건 */
export interface NavEdge {
  /** 떠나는 화면 */
  from: string;
  /** 가는 화면 */
  to: string;
  /** 이동이 적힌 파일 */
  file: string;
  /** 이동이 적힌 줄 */
  line: number;
  /** 어떤 모양으로 적혀 있나(toPath('이름') 등) */
  how: string;
}

/** 이동 대조 결과 */
export interface NavResult {
  /** 코드에서 읽은 이동들 */
  edges: NavEdge[];
  /** 선언과 코드가 어긋난 곳의 경고들 */
  warnings: string[];
  /** 읽은 라우트 표(이름 → 주소) */
  routes?: Record<string, string>;
  /** 대조를 건너뛴 이유(TypeScript를 못 찾았을 때) */
  skipped?: string;
}

// ── 변경 이력 (history) ─────────────────────────────────

/** 승인이나 테스트 요청 때 저장한 화면 스냅샷 */
export interface Snapshot {
  /** 스냅샷 파일 이름 */
  shot: string;
  /** 저장한 시각 */
  at: string;
  /** 어떤 때의 것인가(승인, 테스트 요청) */
  label: string;
}

/** 한 번의 커밋에서 바뀐 덩어리 하나 */
export interface Hunk {
  /** 바뀐 시작 줄 */
  line: number;
  /** 지운 줄들(일부만) */
  removed: string[];
  /** 새로 쓴 줄들(일부만) */
  added: string[];
}

/** 커밋이 바꾼 곳 하나(화면 요소, 정보 필드, 그 밖) */
export interface HistoryPlace {
  /** 어떤 곳인가 */
  kind: 'spec' | 'info' | 'other';
  /** 같은 곳을 묶는 열쇠 */
  key: string;
  /** 사람이 읽는 이름 */
  title: string;
  /** 화면 요소의 이름표 */
  id?: string;
  /** 정보 이름 */
  info?: string;
  /** 정보 필드 이름 */
  prop?: string | null;
  /** 바뀐 파일 */
  file: string;
  /** 바뀐 첫 줄 */
  line: number;
  /** 새로 쓴 줄 수 */
  added: number;
  /** 지운 줄 수 */
  removed: number;
  /** 바뀐 덩어리들(일부만) */
  hunks: Hunk[];
}

/** 이력의 커밋 한 건 */
export interface HistoryCommit {
  /** 이력 항목의 종류 */
  type: 'commit';
  /** 변경인지 오류 수정인지 */
  kind: string;
  /** 커밋 해시(짧게) */
  hash: string;
  /** 커밋한 시각 */
  at: string;
  /** 커밋한 사람 */
  author: string;
  /** 사람이 읽는 제목 */
  title: string;
  /** 커밋의 요청 줄 */
  request: string;
  /** 커밋의 결정 줄들 */
  decisions: string[];
  /** 커밋의 기각 줄들 */
  rejections: string[];
  /** 커밋의 원인 줄 */
  cause: string;
  /** 이 화면 파일 중 바뀐 파일 수 */
  files: number | undefined;
  /** 바뀐 파일 목록 */
  fileList: string[];
  /** 바뀐 곳들 */
  places: HistoryPlace[];
  /** 바뀐 화면 요소 이름표들 */
  touchedSpecs: string[];
  /** 바뀐 정보와 필드들 */
  touchedInfos: { name: string; fields: string[] }[];
  /** 이 커밋 직전의 화면 스냅샷 */
  before?: Snapshot | null;
  /** 이 커밋 직후의 화면 스냅샷 */
  after?: Snapshot | null;
  /** 이 항목 자체에 붙은 스냅샷 */
  shot?: string;
}

/** 이력의 상태 기록 한 건(테스트 요청, 승인, 수정 필요) */
export interface HistoryStatus {
  /** 이력 항목의 종류 */
  type: 'status';
  /** 어떤 상태 기록인가 */
  kind: string;
  /** 그때의 소스 버전 */
  hash: string;
  /** 남긴 시각 */
  at: string;
  /** 남긴 사람(사용자, 에이전트) */
  author: string;
  /** 함께 남긴 한 줄 메모 */
  title: string;
  /** 결정 줄들(상태 기록에는 없음) */
  decisions: string[];
  /** 기각 줄들(상태 기록에는 없음) */
  rejections: string[];
  /** 그때 저장한 화면 스냅샷 */
  shot?: string;
  /** 이 기록 직전의 화면 스냅샷 */
  before?: Snapshot | null;
  /** 이 기록 직후의 화면 스냅샷 */
  after?: Snapshot | null;
}

/** 이력 한 건: 커밋 또는 상태 기록 */
export type HistoryItem = HistoryCommit | HistoryStatus;

// ── 설계서 보기가 읽는 모델 (model) ────────────────────────

/** 정보가 화면에서 하는 일: 보여줌, 입력, 수정, 판단 */
export type Role = 'shown' | 'input' | 'modify' | 'judge';

/** 필드의 역할을 그렇게 읽은 근거 한 곳 */
export interface Evidence {
  /** 어떤 역할로 읽었나 */
  role: Role;
  /** 누가(화면 이름이나 모듈 이름) */
  who: string;
  /** 어느 파일 */
  file: string;
  /** 몇째 줄 */
  line: number;
  /** 참조의 종류 */
  kind: RefKind;
}

/** 화면에 보여 줄 필드 하나 */
export interface ModelProp {
  /** 필드 이름 */
  name: string;
  /** 타입 글자 */
  type: string;
  /** 없어도 되는 필드인가 */
  optional: boolean;
  /** 존재 이유 */
  doc: string;
  /** 정의된 줄 */
  line: number;
  /** 쓰이는 모습 */
  status: PropStatus;
  /** 역할별로 쓰는 화면이나 모듈 */
  roles: Record<Role, string[]>;
  /** 역할을 그렇게 읽은 근거들 */
  evidence: Evidence[];
}

/** 정보의 쓰임: 화면이 보여주거나 입력받는 정보(screen)인지, 화면과 닿지 않는 내부용(internal)인지 */
export type InfoKind = 'screen' | 'internal';

/** 화면에 보여 줄 정보 하나 */
export interface ModelInfo {
  /** 정보 이름 */
  name: string;
  /** 정의된 파일(프로젝트 기준) */
  file: string;
  /** 정의된 파일(소스 폴더 기준) */
  fileSrc: string;
  /** 정의된 줄 */
  line: number;
  /** 존재 이유 */
  doc: string;
  /** 어디에서도 쓰이지 않는가 */
  unused: boolean;
  /** 화면용인지 내부용인지(화면이 보여주거나 입력받거나 고치면 화면용). 코드에서 계산한다 */
  kind: InfoKind;
  /** 역할별로 쓰는 화면이나 모듈 */
  flow: Record<Role, string[]>;
  /** 필드들 */
  props: ModelProp[];
  /** 확인이 필요한 필드 수 */
  flagged: number;
  /** 존재 이유가 비어 있는 필드 수 */
  unfilled: number;
}

/** 정보 사이의 관계 한 줄 */
export interface Relation {
  /** 가리키는 쪽 정보 */
  from: string;
  /** 가리켜지는 쪽 정보 */
  to: string;
  /** 관계를 드러내는 필드 이름 */
  field: string;
  /** 그 필드의 설명 */
  fieldDoc: string;
  /** 값으로만 가리키는 약한 연결인가 */
  weak: boolean;
  /** 개수 관계(N, 0..N) */
  many: string;
  /** 약한 연결이 가리키는 대상 필드 */
  targetField?: string;
}

/** 한 화면이 다루는 정보 필드 하나 */
export interface ScreenField {
  /** 정보 이름 */
  info: string;
  /** 필드 이름 */
  prop: string;
  /** 필드의 설명 */
  doc: string;
  /** 이 화면에서 하는 일들 */
  roles: Role[];
  /** 이 필드를 쓰는 요소들의 이름표 */
  specs: string[];
  /** 화면에서 이 값이 그려지는 자리를 찾을 힌트들 */
  doms: DomHint[];
}

/** 어느 화면에서 이 화면으로 들어오는 길 */
export interface Incoming {
  /** 떠나는 화면 */
  from: string;
  /** 어떻게 오는가 */
  action: string;
  /** 넘기는 값 */
  pass: string;
}

/** 화면 한 장에 대한 설계서 보기 모델 */
export interface ModelScreen extends Omit<ScreenTag, 'to'> {
  /** 나가는 길과 그것이 코드에서 확인됐는지 */
  to: (Move & { verified: boolean })[];
  /** 시작 화면에서 몇 번째 단계인가 */
  stage: number;
  /** 들어오는 길 */
  incoming: Incoming[];
  /** 지금 상태 */
  status: ScreenStatus;
  /** 이 화면에 속한 요소들의 이름표 */
  specIds: string[];
  /** 이 화면이 다루는 정보 필드들 */
  fields: ScreenField[];
  /** 이 화면이 다루는 정보의 수 */
  infoCount: number;
  /** 이 화면의 메모 수 */
  memoCount: number;
  /** 전달 전(대기) 메모 수 */
  memoPending: number;
  /** 존재 이유가 빈 곳의 수 */
  missing: number;
  /** 이 화면과 관련된 경고들 */
  warnings: string[];
}

/** 화면 흐름 왼쪽에 보여 줄 "확인 필요" 안내 한 줄 */
export interface Note {
  /** 관련 화면 */
  screen?: string;
  /** 관련 정보 */
  info?: string;
  /** 안내 문장 */
  text: string;
}

/** 위쪽 칩에 보여 줄 개수 모음 */
export interface ModelSummary {
  /** 화면 수 */
  screens: number;
  /** 화면 이동 선언 수 */
  moves: number;
  /** 정보 수 */
  infos: number;
  /** 정보 관계 수 */
  relations: number;
  /** 사용자 확인을 기다리는 화면 수 */
  waiting: number;
  /** 테스트 요청 상태인 화면 수 */
  testRequested: number;
  /** 승인 뒤 바뀐 화면 수 */
  changedAfterApproval: number;
  /** 내 차례인 요청 수 */
  requestsMine: number;
  /** 에이전트에게 아직 전달하지 않은 메모 수 */
  memosUndelivered: number;
  /** 확인이 필요한 곳의 수 */
  needCheck: number;
}

/** 설계서 보기 화면이 읽는 모델 한 덩어리 */
export interface Model {
  /** 프로젝트 이름 */
  project: string;
  /** 모델을 만든 시각 */
  generatedAt: string;
  /** 화면들 */
  screens: ModelScreen[];
  /** 요소들 */
  specs: Spec[];
  /** 정보들 */
  infos: ModelInfo[];
  /** 정보 관계들 */
  relations: Relation[];
  /** 확인 필요 안내들 */
  notes: Note[];
  /** 메타정보 경고들 */
  warnings: string[];
  /** 정보 분석이 실패했을 때의 이유 */
  analysisError: string;
  /** 메모들 */
  memos: (Memo & { stateLabel: string })[];
  /** 변경 요청들 */
  requests: RequestView[];
  /** 개수 모음 */
  summary: ModelSummary;
  /** 상태 이름의 화면용 글자 */
  labels: Record<string, string>;
}

// ── 프로젝트 설정 (.spec/config.json) ────────────────────

/** 프로젝트가 설계서 보기에 알려 주는 설정 */
export interface ProjectConfig {
  /** 소스 폴더(프로젝트 루트 기준). 안 적으면 src */
  src?: string;
  /** 앱 개발 서버 주소. null이면 앱 서버가 없는 프로젝트라 설계서 보기만 띄운다 */
  app?: string | null;
  /** 설계서 보기 서버가 쓸 포트. 안 적으면 5290 */
  port?: number;
  /** 앱 개발 서버를 띄우는 명령. 안 적으면 npm run dev */
  start?: string;
  /** 설계 디자인을 요청마다 모아 두는 Claude Design 캔버스 주소 */
  designCanvas?: string;
  /** 화면 이동을 읽는 방법: 라우트 표의 이름과 이동 도우미 함수들 */
  navigation?: {
    /** 이름 → 주소가 적힌 라우트 표의 변수 이름 */
    routes?: string;
    /** 이동을 일으키는 도우미 함수 이름들 */
    helpers?: string[];
    /** 주소(#/…)를 만드는 도우미 함수 이름들(예: hash). 첫 글자값이 보는 곳, 둘째 값이 있으면 대상이다 */
    hashHelpers?: string[];
    /** 도우미가 만든 주소 앞에 붙는 길(예: /__spec/) */
    hashPrefix?: string;
  };
}
