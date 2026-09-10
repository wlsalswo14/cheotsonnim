import type { PersonaId } from "./types";

export interface Persona {
  id: PersonaId;
  name: string;
  emoji: string;
  tagline: string;
  lens: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "busy",
    name: "바쁜 손님",
    emoji: "⏱️",
    tagline: "점심시간에 폰 붙잡고 3초 안에 답을 찾는 직장인",
    lens: "3초 안에 이 사이트가 무엇인지, 내가 원하는 행동을 어디서 시작하는지 못 찾으면 바로 이탈. 핵심 행동 버튼의 위치와 문구, 첫 화면의 정보 밀도, 불필요한 팝업을 본다.",
  },
  {
    id: "senior",
    name: "어르신 손님",
    emoji: "👓",
    tagline: "돋보기 쓰고 천천히 읽는 68세, 영어 약어에 약함",
    lens: "글자 크기와 대비, 외래어·전문용어·영문 약어, 버튼처럼 보이지 않는 버튼, 다음에 뭘 해야 하는지 알려주는 안내 문구, 되돌리기 쉬운지 본다.",
  },
  {
    id: "mobile",
    name: "모바일 손님",
    emoji: "📱",
    tagline: "한 손 엄지로만 조작하는 지하철 안 이용자",
    lens: "모바일 화면에서 가로 스크롤이 생기는지, 버튼이 엄지로 누르기에 충분히 큰지(44px), 텍스트가 잘리거나 겹치는지, 첫 화면에 핵심이 들어오는지 본다.",
  },
  {
    id: "screenreader",
    name: "스크린리더 손님",
    emoji: "🎧",
    tagline: "화면을 보지 않고 스크린리더로 듣는 시각장애인",
    lens: "이미지 대체텍스트, 이름 없는 버튼과 링크, 라벨 없는 입력창, 제목(h1) 구조, 키보드만으로 도달 가능한지 본다. 점검표의 접근성 항목을 근거로 삼는다.",
  },
  {
    id: "skeptic",
    name: "깐깐한 손님",
    emoji: "🧐",
    tagline: "결제 전에 회사 정보와 약관부터 찾아보는 사람",
    lens: "이 사이트를 믿어도 되는지: HTTPS, 운영 주체와 연락처, 가격과 조건의 투명성, 다크 패턴(숨은 비용, 강제 가입, 취소 어려움), 개인정보 요구의 적절성을 본다.",
  },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((persona) => [persona.id, persona])) as Record<PersonaId, Persona>;
