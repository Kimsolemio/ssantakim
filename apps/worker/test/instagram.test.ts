import { describe, expect, it } from "vitest";
import { captionFromOgDescription, instagramShortcode, looksBlocked, parseInstagramEmbed } from "../src/instagram";

describe("instagram helpers", () => {
  it("reads the reel video address from the embed data, from Instagram's CDN only", () => {
    const page = (video: string) => `<script>{"contextJSON":${JSON.stringify(JSON.stringify({ context: { media: { is_video: true, video_url: video } } }))}}</script>`;
    expect(parseInstagramEmbed(page("https://scontent-iad6-1.cdninstagram.com/o1/reel.mp4?oh=1")).video).toBe("https://scontent-iad6-1.cdninstagram.com/o1/reel.mp4?oh=1");
    expect(parseInstagramEmbed(page("https://video.fbcdn.net/reel.mp4")).video).toBe("https://video.fbcdn.net/reel.mp4");
    expect(parseInstagramEmbed(page("https://evil.example.com/reel.mp4")).video).toBeNull();
    expect(parseInstagramEmbed(page("http://scontent.cdninstagram.com/reel.mp4")).video).toBeNull();
    // 감싸지 않은 데이터에서도
    expect(parseInstagramEmbed(`{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v.mp4"}`).video).toBe("https://scontent.cdninstagram.com/v.mp4");
  });
  it("counts refusals and login redirects as blocking, not a missing post", () => {
    expect(looksBlocked(new Response("", { status: 429 }))).toBe(true);
    expect(looksBlocked(new Response("", { status: 403 }))).toBe(true);
    expect(looksBlocked(new Response("", { status: 302, headers: { location: "https://www.instagram.com/accounts/login/" } }))).toBe(true);
    expect(looksBlocked(new Response("", { status: 302, headers: { location: "https://www.instagram.com/challenge/?next=/p/x/" } }))).toBe(true);
    expect(looksBlocked(new Response("", { status: 301, headers: { location: "https://www.instagram.com/reel/C1abcDEF/" } }))).toBe(false);
    expect(looksBlocked(new Response("", { status: 404 }))).toBe(false);
  });
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
