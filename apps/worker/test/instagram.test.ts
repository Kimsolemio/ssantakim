import { describe, expect, it } from "vitest";
import { captionFromOgDescription, instagramShortcode, parseInstagramEmbed } from "../src/instagram";

describe("instagram helpers", () => {
  it("finds the post code in post, reel and tv links only", () => {
    expect(instagramShortcode("https://www.instagram.com/reel/C1abcDEF/?igsh=x")).toBe("C1abcDEF");
    expect(instagramShortcode("https://instagram.com/p/Cx-y_z12/")).toBe("Cx-y_z12");
    expect(instagramShortcode("https://www.instagram.com/cook_mom/reel/C1abcDEF/")).toBe("C1abcDEF");
    expect(instagramShortcode("https://www.instagram.com/cook_mom/")).toBeNull();
    expect(instagramShortcode("https://evil.example/p/C1abcDEF/")).toBeNull();
    expect(instagramShortcode("https://www.instagram.com/reels/audio/1234567/")).toBeNull();
    expect(instagramShortcode("https://www.instagram.com/share/reel/BAxyz123/")).toBeNull();
  });
  it("keeps only Instagram image hosts", () => {
    const html = `<img class="EmbeddedMediaImage" src="https://evil.example/x.jpg"><div class="Caption">짧은 글</div>`;
    expect(parseInstagramEmbed(html).image).toBeNull();
    expect(parseInstagramEmbed(`<img class="EmbeddedMediaImage" src="https://scontent-icn2-1.cdninstagram.com/a.jpg?x=1&amp;y=2">`).image).toBe("https://scontent-icn2-1.cdninstagram.com/a.jpg?x=1&y=2");
  });
  it("reads unwrapped caption data", () => {
    const html = `{"edge_media_to_caption":{"edges":[{"node":{"text":"김치찌개\\n김치 300g"}}]}}`;
    expect(parseInstagramEmbed(html).caption).toBe("김치찌개\n김치 300g");
  });
  it("pulls the quoted caption out of the preview text", () => {
    expect(captionFromOgDescription('1,234 likes, 5 comments - cook_mom on October 20, 2026: "Egg roll: 4 eggs, salt"')).toBe("Egg roll: 4 eggs, salt");
    expect(captionFromOgDescription("See Instagram photos and videos from cook_mom")).toBeNull();
  });
});
