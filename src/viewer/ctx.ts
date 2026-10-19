/**
 * @spec screen-ctx 화면 설계서의 제어 객체 모양
 * @why 화면 설계서는 왼쪽 실제 화면과 오른쪽 탭 다섯 개가 같은 상태(고른 요소, 쓰는 중인 메모, 열린 정보 상세 등)를 함께 보고 바꾼다. 그 상태와 동작을 한 객체로 모아, 탭 파일들이 screen.ts 안쪽을 몰라도 쓰게 한다.
 * @contract screen.ts가 이 객체를 만들고 tabs.ts의 탭들이 받아 쓴다. 상태를 바꾼 뒤에는 render()를 불러야 오른쪽 패널이 다시 그려진다.
 */
import type { Memo, MemoTarget, Model, ModelScreen, Role, ScreenField, Spec } from '../types.js';

/** 오른쪽 패널의 탭 */
export type TabName = 'overview' | 'components' | 'memo' | 'approval' | 'history';

/** 화면 위에 그려진 상자 하나의 자리(화면 기준) */
export interface Box {
  /** 왼쪽 끝 */
  left: number;
  /** 위쪽 끝 */
  top: number;
  /** 오른쪽 끝 */
  right: number;
  /** 아래쪽 끝 */
  bottom: number;
}

/**
 * 화면 설계서의 제어 객체(상태와 동작).
 * @nonInfo 데이터 정의가 아니라 화면 파일들이 함께 쓰는 제어용 객체다
 */
export interface ScreenCtx {
  /** 지금 읽고 있는 모델(서버에서 새로 받으면 바뀐다) */
  model: Model;
  /** 지금 보고 있는 화면 이름 */
  name: string;
  /** 지금 열린 탭 */
  tab: TabName;
  /** 화면을 처음 열 때 지정한 실제 화면 주소 */
  at: string | null | undefined;
  /** 개요에서 고른 정보 필드 */
  focus: { info: string; prop: string } | null;
  /** 열려 있는 정보 상세(없으면 탭이 보인다) */
  drawer: { info: string; prop?: string } | null;
  /** 히스토리에서 펼친 "바뀐 곳" 열쇠들 */
  hOpen: Set<string>;
  /** 화면에서 강조할 컴포넌트 이름표들 */
  hl: Set<string>;
  /** 컴포넌트 탭에서 고른 컴포넌트 */
  active: string | null;
  /** 개요에서 거른 정보 역할 */
  fieldRole: Role | null;
  /** 히스토리 필터 이름 */
  hFilter: string;
  /** 히스토리에서 상세를 펼친 항목의 열쇠 */
  hSel?: string | null;
  /** 쓰는 중인 메모의 대상(없으면 메모를 쓰는 중이 아님) */
  draft: MemoTarget | null;
  /** 쓰는 중인 메모의 글 */
  draftText: string;
  /** 승인 탭의 "문제 있음" 입력 상태 */
  ap: { problem: boolean; text?: string; target?: string; region?: MemoTarget };
  /** 화면 위에서 영역을 고르는 중인가 */
  regionMode: boolean;
  /** 영역 고르기가 오류 기록용인가(메모용이 아니라) */
  regionForError?: boolean;
  /** 화면 위 번호표를 보이는가 */
  showNumbers: boolean;
  /** 히스토리에서 고른 변경이 바꾼 요소를 깜빡이는가 */
  flash?: boolean;
  /** 올려 둔 정보 필드(그 값이 나오는 자리를 화면에서 강조) */
  hlField?: ScreenField | null;
  /** 이 화면에 속한 요소들(화면 요소 먼저, 로직 나중) */
  specs: Spec[];

  /** 지금 화면의 모델 */
  sc(): ModelScreen;
  /** 실제 화면이 지금 열어 둔 주소 */
  route(): string;
  /** 요소의 번호표 번호(1부터, 없으면 0) */
  num(id: string): number;
  /** 오른쪽 패널을 다시 그린다 */
  render(): void;
  /** 탭을 바꾼다 */
  setTab(t: TabName): void;
  /** 강조할 컴포넌트들을 정한다 */
  setHL(s: Set<string>): void;
  /** 올려 둔 정보 필드를 정한다 */
  setHLField(f: ScreenField | null): void;
  /** 정보 필드를 열어 정보 상세와 화면 위치를 보인다 */
  openField(f: ScreenField): void;
  /** 고른 컴포넌트를 정한다 */
  setActive(id: string | null): void;
  /** 숨은 컴포넌트를 눌러서 열어 본다. 열렸으면 true */
  revealSpec(id: string): Promise<boolean>;
  /** 컴포넌트 카드를 눌렀을 때: 필요하면 열고, 강조하고, 화면에서 그 자리로 이동 */
  pickComp(id: string): Promise<void>;
  /** 정보 상세를 연다 */
  openInfo(info: string, prop?: string): void;
  /** 다른 화면으로 간다 */
  go(name: string): void;
  /** 서버에서 모델을 다시 받는다 */
  refresh(): Promise<void>;
  /** 전달하지 않은 메모를 에이전트에게 붙여 넣을 글로 복사한다 */
  copyRequest(): Promise<void>;
  /** 컴포넌트(없으면 화면 전체)에 메모를 쓰기 시작한다 */
  startMemoFor(s: Spec | null): void;
  /** 화면을 찍어 PNG 데이터 주소로 돌려준다(영역을 주면 그 부분만) */
  capture(rect?: { x: number; y: number; w: number; h: number }): Promise<string>;
  /** 찍은 화면을 서버에 올리고 파일 이름을 돌려준다 */
  uploadShot(data: string, prefix: string): Promise<string>;
  /** 컴포넌트가 지금 실제 화면에 있는가 */
  isOnScreen(id: string): boolean;
  /** 화면에서 그 컴포넌트 자리로 스크롤한다 */
  focusSpec(id: string): void;
  /** 표시 가능 여부: ok 테두리로 보임, big 화면 대부분이라 생략, none 지금 화면에 없음, logic 화면에 안 보이는 로직 */
  spanState(id: string): 'ok' | 'big' | 'none' | 'logic';
  /** 바뀐 요소들을 깜빡이는 노란 테두리로 보인다 */
  setFlash(ids: string[]): void;
  /** 화면 위에서 영역 고르기를 시작한다 */
  startRegion(opts?: { forError?: boolean }): void;
}

/** 서버가 돌려주는 메모 한 건(화면용 이름 포함) */
export type MemoView = Memo & { stateLabel: string };
