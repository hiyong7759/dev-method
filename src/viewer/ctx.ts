/**
 * @spec screen-ctx 화면 설계서의 제어 객체 모양
 * @why 화면 설계서는 왼쪽 실제 화면과 오른쪽 탭 셋(개요·현행·히스토리)이 같은 상태(고른 컴포넌트, 열린 정보 상세 등)를 함께 보고 바꾼다. 그 상태와 동작을 한 객체로 모아, 탭 파일들이 screen.ts 안쪽을 몰라도 쓰게 한다.
 * @contract screen.ts가 이 객체를 만들고 tabs.ts의 탭들이 받아 쓴다. 상태를 바꾼 뒤에는 render()를 불러야 오른쪽 패널이 다시 그려진다.
 */
import type { Model, ModelScreen, Spec } from '../types.js';

/** 오른쪽 패널의 탭 */
export type TabName = 'overview' | 'now' | 'history';

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
  /** 열려 있는 정보 상세(없으면 탭이 보인다) */
  drawer: { info: string } | null;
  /** 히스토리에서 고른 거르기 이름 */
  hFilter: string;
  /** 현행 탭에서 고른 컴포넌트 */
  active: string | null;
  /** 이 화면에 속한 요소들(화면 요소 먼저, 로직 나중) */
  specs: Spec[];

  /** 지금 화면의 모델 */
  sc(): ModelScreen;
  /** 요소의 번호(1부터, 없으면 0) */
  num(id: string): number;
  /** 부품 안의 부품 깊이(바깥 부품 0, 그 안 1…). 실제 화면의 틀 겹침으로 잰다 */
  depthOf(id: string): number;
  /** 실제 화면에서 이 부품이 보이는 곳의 수(안 보이면 0) */
  countOf(id: string): number;
  /** 오른쪽 패널을 다시 그린다 */
  render(): void;
  /** 탭을 바꾼다 */
  setTab(t: TabName): void;
  /** 컴포넌트 카드를 눌렀을 때: 필요하면 열고, 강조하고, 화면에서 그 자리로 이동 */
  pickComp(id: string): Promise<void>;
  /** 정보 상세를 연다 */
  openInfo(info: string): void;
  /** 다른 화면으로 간다 */
  go(name: string): void;
  /** 컴포넌트가 지금 실제 화면에 있는가 */
  isOnScreen(id: string): boolean;
  /** 숨은 컴포넌트를 눌러서 열어 본다. 열렸으면 true */
  revealSpec(id: string): Promise<boolean>;
}
