import { describe, expect, it } from "vitest";
import { youtubeId, linkKind, naverBlogMobileUrl, isSafePublicUrl, htmlToText, jsonLdRecipeText, metaContent, youtubePageInfo, decodeEntities } from "../src/extract";

describe("link parsing", () => {
  it("finds YouTube ids in every URL shape", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ?si=x", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/live/dQw4w9WgXcQ"]) {
      expect(youtubeId(u), u).toBe("dQw4w9WgXcQ");
    }
    expect(youtubeId("https://www.youtube.com/@channel")).toBeNull();
    expect(youtubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("classifies links", () => {
    expect(linkKind("https://www.instagram.com/reel/Cxyz/")).toBe("instagram");
    expect(linkKind("https://blog.naver.com/cook/223000000000")).toBe("naver_blog");
    expect(linkKind("https://www.10000recipe.com/recipe/123")).toBe("web");
  });
  it("rewrites Naver blog links to the mobile page", () => {
    expect(naverBlogMobileUrl("https://blog.naver.com/cook_mom/223456789012")).toBe("https://m.blog.naver.com/cook_mom/223456789012");
    expect(naverBlogMobileUrl("https://blog.naver.com/PostView.naver?blogId=cook_mom&logNo=223456789012")).toBe("https://m.blog.naver.com/cook_mom/223456789012");
  });
  it("blocks private and odd URLs", () => {
    for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/a", "http://192.168.0.1/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://intranet/", "https://a.internal/x", "http://user:pw@example.com/", "http://example.com:8080/", "http://[::1]/",
      "http://localhost./", "http://10.0.0.1./", "http://0x7f.0.0.1/", "http://127.1/", "http://127.0.0.1.nip.io/", "https://10-0-0-1.sslip.io/", "http://app.localtest.me/", "http://a.test/"]) {
      expect(isSafePublicUrl(u), u).toBe(false);
    }
    expect(isSafePublicUrl("https://m.blog.naver.com/a/1")).toBe(true);
    expect(isSafePublicUrl("https://www.10000recipe.com./recipe/1")).toBe(true);
  });
});

describe("html extraction", () => {
  const html = `<html><head><title>t</title><meta property="og:title" content="엄마표 김치찌개 &amp; 계란말이"><script>var x=1</script></head>
  <body><nav>메뉴</nav><h1>김치찌개</h1><p>재료</p><ul><li>김치 300g</li><li>돼지고기 200g</li></ul><style>.a{}</style><p>1. 볶는다&nbsp;</p>
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"김치찌개","recipeYield":"2인분","recipeIngredient":["김치 300g","돼지고기 200g"],
  "recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"고기를 볶는다"},{"@type":"HowToStep","text":"김치를 넣는다"}]}]}]}</script></body></html>`;
  it("reads meta tags and decodes entities", () => {
    expect(metaContent(html, "og:title")).toBe("엄마표 김치찌개 & 계란말이");
    expect(decodeEntities("&#44032;&#x1F373;&lt;")).toBe("가🍳<");
  });
  it("turns the body into readable text without scripts", () => {
    const t = htmlToText(html);
    expect(t).toContain("- 김치 300g");
    expect(t).toContain("1. 볶는다");
    expect(t).not.toContain("var x");
    expect(t).not.toContain(".a{}");
  });
  it("extracts schema.org Recipe from JSON-LD graphs and sections", () => {
    const t = jsonLdRecipeText(html)!;
    expect(t).toContain("요리 이름: 김치찌개");
    expect(t).toContain("- 돼지고기 200g");
    expect(t).toContain("2. 김치를 넣는다");
    expect(jsonLdRecipeText("<html><body>no</body></html>")).toBeNull();
  });
  it("reads YouTube page JSON when there is no API key", () => {
    const page = `<meta property="og:title" content="10분 알리오올리오"><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"10분 알리오올리오","author":"요리채널","shortDescription":"재료\\n- 스파게티 200g\\n- 마늘 \\"8쪽\\""}};</script>`;
    expect(youtubePageInfo(page)).toEqual({ title: "10분 알리오올리오", channel: "요리채널", description: '재료\n- 스파게티 200g\n- 마늘 "8쪽"' });
  });
});
