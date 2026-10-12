/**
 * 가족 알레르기 ↔ 레시피 재료 대조 (이름으로만 확인하는 보조 장치).
 * 한국 식품 알레르기 표시 대상(22종)을 중심으로, 그 성분이 흔히 숨어 있는 재료 이름을 함께 찾는다.
 * 시판 소스·가공식품의 실제 성분은 포장 표시를 확인해야 한다.
 */
import { provisionalKey } from "./keys";

/** 알레르기 이름(사용자가 적는 말) → 그 성분이 들어 있을 수 있는 재료 이름들 */
const ALLERGEN_WORDS: Record<string, string[]> = {
  달걀: ["달걀", "계란", "메추리알", "노른자", "흰자", "마요네즈", "에그"],
  우유: ["우유", "치즈", "버터", "생크림", "휘핑크림", "사워크림", "크림치즈", "요거트", "요구르트", "연유", "분유", "모짜렐라", "파마산", "리코타", "밀크"],
  밀: ["밀가루", "부침가루", "튀김가루", "빵가루", "빵", "식빵", "국수", "소면", "중면", "칼국수", "라면", "우동", "스파게티", "파스타", "펜네", "마카로니", "만두", "밀떡", "간장", "고추장", "굴소스", "춘장", "짜장", "카레", "돈가스소스", "맥주", "또띠아", "수제비"],
  대두: ["콩", "두부", "순두부", "연두부", "유부", "두유", "간장", "된장", "청국장", "고추장", "쌈장", "춘장", "콩나물", "낫토", "에다마메"],
  땅콩: ["땅콩", "피넛"],
  호두: ["호두"],
  잣: ["잣"],
  견과류: ["땅콩", "호두", "잣", "아몬드", "캐슈", "피스타치오", "헤이즐넛", "마카다미아", "피칸", "브라질너트", "견과"],
  새우: ["새우", "대하", "새우젓", "크릴", "칵테일새우"],
  게: ["게", "꽃게", "대게", "킹크랩", "크랩", "게맛살"],
  갑각류: ["새우", "대하", "새우젓", "게", "꽃게", "대게", "크랩", "랍스터", "가재"],
  조개류: ["조개", "바지락", "홍합", "굴", "전복", "가리비", "모시조개", "꼬막", "재첩", "키조개", "굴소스"],
  오징어: ["오징어", "한치", "갑오징어"],
  고등어: ["고등어"],
  생선: ["생선", "멸치", "액젓", "피시소스", "고등어", "연어", "참치", "어묵", "명태", "황태", "대구", "갈치", "꽁치", "삼치"],
  메밀: ["메밀", "냉면"],
  복숭아: ["복숭아"],
  토마토: ["토마토", "케첩", "케찹"],
  돼지고기: ["돼지고기", "삼겹살", "목살", "앞다리", "뒷다리", "베이컨", "햄", "소시지", "스팸", "돈육", "족발"],
  닭고기: ["닭", "닭고기", "닭가슴살", "치킨", "닭다리"],
  소고기: ["소고기", "쇠고기", "차돌", "우삼겹", "양지", "사골", "다시다", "불고기용"],
  참깨: ["참깨", "깨", "참기름", "통깨"],
  아황산류: ["와인", "건포도", "건과일", "말린과일"],
};

/** 같은 알레르기의 다른 이름 */
const ALIASES: Record<string, string> = {
  계란: "달걀", 알류: "달걀", 난류: "달걀", 유제품: "우유", 유당: "우유", 글루텐: "밀", 콩: "대두", 쇠고기: "소고기",
  견과: "견과류", 너트: "견과류", 해산물: "갑각류", 조개: "조개류", 패류: "조개류", 어류: "생선", 깨: "참깨",
};

export type AllergyHit = { allergy: string; ingredient: string };

/** 한 글자 재료(게·굴·콩·잣·햄·빵)는 앞이나 끝이 같을 때만 본다 (게맛살·꽃게 O, "게" 들어간 다른 말 X) */
function nameHas(name: string, word: string): boolean {
  if (word.length >= 2) return name.includes(word);
  return name === word || name.startsWith(word) || name.endsWith(word);
}

/** 재료 이름에서 가족 알레르기 성분을 찾는다 */
export function findAllergens(ingredients: { name: string }[], allergies: readonly string[]): AllergyHit[] {
  const hits: AllergyHit[] = [];
  for (const raw of allergies) {
    const a = provisionalKey(raw);
    if (!a) continue;
    const canon = ALIASES[a] ?? a;
    const words = [...new Set([a, ...(ALLERGEN_WORDS[canon] ?? [])])];
    for (const ing of ingredients) {
      const n = provisionalKey(ing.name);
      if (words.some((w) => nameHas(n, w))) hits.push({ allergy: raw.trim(), ingredient: ing.name });
    }
  }
  return hits;
}

/** 싫어하는 재료는 이름이 들어 있는지만 본다 */
export function findDislikes(ingredients: { name: string }[], dislikes: readonly string[]): AllergyHit[] {
  const hits: AllergyHit[] = [];
  for (const raw of dislikes) {
    const d = provisionalKey(raw);
    if (d.length === 0) continue;
    for (const ing of ingredients) if (nameHas(provisionalKey(ing.name), d)) hits.push({ allergy: raw.trim(), ingredient: ing.name });
  }
  return hits;
}
