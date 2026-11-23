// 한국수어 지문자 중 기본 자음 14개
export const CONSONANTS = [
  { ch: 'ㄱ', name: '기역' },
  { ch: 'ㄴ', name: '니은' },
  { ch: 'ㄷ', name: '디귿' },
  { ch: 'ㄹ', name: '리을' },
  { ch: 'ㅁ', name: '미음' },
  { ch: 'ㅂ', name: '비읍' },
  { ch: 'ㅅ', name: '시옷' },
  { ch: 'ㅇ', name: '이응' },
  { ch: 'ㅈ', name: '지읒' },
  { ch: 'ㅊ', name: '치읓' },
  { ch: 'ㅋ', name: '키읔' },
  { ch: 'ㅌ', name: '티읕' },
  { ch: 'ㅍ', name: '피읖' },
  { ch: 'ㅎ', name: '히읗' },
];

export const NAME_OF = Object.fromEntries(CONSONANTS.map((c) => [c.ch, c.name]));
