/** 체험판 처음 데이터: 처음 들어오면 가족·레시피·냉장고·장보기·식단을 채워 둔다 */
import { FamilyProfile, addDays, localDate, makeInviteCode, weekStart } from "@cook/shared";
import { collection, doc, getDoc, writeBatch, getFirestore } from "./firestore";
import { DEMO_RECIPES } from "./recipes";

export async function seedDemo(uid: string) {
  const db = getFirestore();
  if ((await getDoc(doc(db, "users", uid))).exists()) return;
  const today = localDate();
  const now = new Date().toISOString();
  const fid = "demo-family";
  const code = makeInviteCode();
  const b = writeBatch(db);
  b.set(doc(db, "families", fid), {
    name: "우리집", inviteCode: code, members: [uid], createdAt: now,
    profile: FamilyProfile.parse({ dislikes: ["고수"], kidsFriendly: true }),
  });
  b.set(doc(db, "invites", code), { familyId: fid });
  b.set(doc(db, "users", uid), { familyId: fid, name: "나", updatedAt: now });

  // 레시피 (뒤에 만든 것이 위로)
  const ids: Record<string, string> = {};
  DEMO_RECIPES.slice(0, 5).forEach(({ match: _m, ...r }, i) => {
    const ref = doc(collection(db, "families", fid, "recipes"));
    ids[r.title] = ref.id;
    b.set(ref, {
      ...r, folderId: null, favorite: i === 1, photoUrl: null,
      source: i === 1 ? { type: "youtube", url: "https://www.youtube.com/results?search_query=%EA%B9%80%EC%B9%98%EC%B0%8C%EA%B0%9C", channel: "예시 채널", title: "김치찌개 황금레시피" } : r.source,
      cookedLog: i === 1 ? [{ date: new Date(Date.now() - 3 * 86_400_000).toISOString(), by: uid, servings: 2 }] : [],
      createdAt: new Date(Date.now() - (10 - i) * 3_600_000).toISOString(), createdBy: uid,
    });
  });

  // 냉장고 (기한은 오늘 기준)
  const fridge: [string, string, number | null, string, "냉장" | "냉동" | "실온", number | null, string, string, boolean?][] = [
    ["고등어", "mackerel", 2, "마리", "냉장", 1, "해산물", "🐟", true],
    ["삼겹살", "pork_belly", 600, "g", "냉장", 2, "육류", "🥓", true],
    ["두부", "tofu", 1, "모", "냉장", 3, "두부·콩", "🫘"],
    ["대파", "green_onion", 2, "대", "냉장", 5, "채소", "🌿", true],
    ["우유", "milk", 1, "팩", "냉장", 6, "유제품", "🥛"],
    ["달걀", "egg", 10, "개", "냉장", 18, "달걀", "🥚"],
    ["신김치", "kimchi", 1, "kg", "냉장", 40, "반찬·가공", "🥬"],
    ["애호박", "zucchini", 1, "개", "냉장", 4, "채소", "🥒", true],
    ["간장", "soy_sauce", 500, "ml", "냉장", 300, "소스·양념", "🫙"],
    ["만두", "dumpling", 1, "kg", "냉동", 120, "냉동식품", "🥟"],
    ["양파", "onion", 3, "개", "실온", 25, "채소", "🧅", true],
    ["감자", "potato", 4, "개", "실온", 20, "채소", "🥔", true],
    ["스파게티면", "spaghetti", 500, "g", "실온", 300, "곡물·면", "🍝"],
    ["깐마늘", "garlic", 200, "g", "냉장", 12, "채소", "🧄", true],
  ];
  for (const [name, key, qty, unit, location, days, category, emoji, est] of fridge) {
    b.set(doc(collection(db, "families", fid, "fridge_items")), {
      name, key, qty, unit, location, expiresAt: days == null ? null : addDays(today, days), expiresEstimated: est ?? false,
      addedBy: uid, addedAt: now, photoUrl: null, category, emoji, source: "manual",
    });
  }

  // 장보기
  const shop: [string, string, number | null, string, string, string, string?][] = [
    ["올리브오일", "olive_oil", 1, "병", "소스·양념", "🫒", "알리오올리오"],
    ["참기름", "sesame_oil", 1, "병", "소스·양념", "🫙"],
    ["두부", "tofu", 1, "모", "두부·콩", "🫘", "애호박 된장찌개"],
  ];
  for (const [name, key, qty, unit, category, emoji, recipeTitle] of shop) {
    b.set(doc(collection(db, "families", fid, "shopping_items")), {
      name, key, qty, unit, fromRecipeId: recipeTitle ? ids[recipeTitle] ?? null : null, checked: false, addedBy: uid, addedAt: now,
      category, emoji, ...(recipeTitle ? { recipeTitle } : {}),
    });
  }

  // 이번 주 식단: 오늘 저녁·내일 점심 (주가 바뀌는 날이면 다음 주에 들어간다)
  const plan: [string, "아침" | "점심" | "저녁", string, number][] = [
    [today, "저녁", "돼지고기 김치찌개", 2],
    [addDays(today, 1), "점심", "계란말이", 2],
    [addDays(weekStart(today), 5) > today ? addDays(weekStart(today), 5) : addDays(today, 2), "저녁", "애호박 된장찌개", 3],
  ];
  for (const [date, slot, title, servings] of plan) {
    if (!ids[title]) continue;
    b.set(doc(collection(db, "families", fid, "meal_plans")), { date, slot, recipeId: ids[title], title, servings, createdBy: uid, createdAt: now });
  }
  await b.commit();
}
