/**
 * @spec brand 프로젝트 이름·색·아이콘
 * @why 여러 프로젝트의 설계서 보기를 동시에 띄워도 어느 프로젝트 화면인지 한눈에 알아보게 한다. 화면 머리글·탭 제목·탭 아이콘·담당 세션 이름이 같은 이름·색·아이콘을 쓴다.
 * @basis 설정(.spec/config.json)의 project에서 정하고, 안 적은 것은 폴더 이름과 이름에서 고른 색으로 채운다. 같은 이름이면 늘 같은 색이다.
 * @contract 자동 색은 시험 서버 표지에 쓰는 호박색(노랑·주황 계열)을 뺀 팔레트에서만 고른다. 설정에 직접 적은 색은 그대로 쓴다.
 */
import path from 'node:path';
import { readConfig } from './config.js';
import type { Brand } from './types.js';

/** 자동으로 고르는 색(호박색 계열 제외) */
const PALETTE = ['#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#22c55e', '#6366f1', '#06b6d4', '#ef4444'];
/** 아이콘을 안 적었을 때 쓰는 것 */
const DEFAULT_ICON = '📁';

/** 이름에서 늘 같은 색을 고른다 */
export function autoColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 프로젝트의 이름·색·아이콘 */
export function brandOf(root: string): Brand {
  const p = readConfig(root).project ?? {};
  const name = p.name?.trim() || path.basename(root);
  return { name, color: p.color?.trim() || autoColor(name), icon: p.icon?.trim() || DEFAULT_ICON };
}

/** 프로젝트 이름 뒤에 요청 번호를 붙인 말: "hidden-rule 요청 #1" */
export const withProject = (name: string, text: string): string => `${name} ${text}`;
