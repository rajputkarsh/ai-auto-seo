import { describe, expect, it } from "vitest";
import { esc, html, page, raw } from "./index";

describe("esc", () => {
  it("neutralizes HTML metacharacters", () => {
    expect(esc("<script>\"&'")).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });
});

describe("html template", () => {
  it("escapes interpolated values by default (XSS guard)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    expect(html`<p>${evil}</p>`).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("passes raw() fragments through unescaped", () => {
    expect(html`<div>${raw("<b>ok</b>")}</div>`).toBe("<div><b>ok</b></div>");
  });
});

describe("page", () => {
  it("escapes the title and wraps the body", () => {
    const out = page({ title: "A & B", body: "<main>hi</main>" });
    expect(out).toContain("<title>A &amp; B</title>");
    expect(out).toContain("<main>hi</main>");
  });
});
